import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// 目录审核服务（Task 4）：人工署名、事件留痕、证据链重算、Agent 无权发布 verified
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-catalog-review-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "review.db");
process.env.RIGMATE_BUILDCORES_CATALOG_PATH = join(tempDir, "no-buildcores.json");
process.env.RIGMATE_MANUAL_CATALOG_PATH = join(tempDir, "no-manual.json");

const service = await import("@/application/catalog-review/service");
const repo = await import("@/infra/db/repositories/catalog-repository");
const { listQualityEvents } = await import("@/infra/db/repositories/quality-repository");
const { listProductSources } = await import("@/infra/db/repositories/evidence-repository");
const { closeDatabase } = await import("@/infra/db/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

const GPU_ID = "gpu-review-1";
const GPU_ID_2 = "gpu-review-3"; // 独立产品：避免跨用例证据串场

function seedGpu(spec: Record<string, unknown> = { tdpWatts: 220 }) {
  repo.upsertCatalogEntries([
    { id: GPU_ID, category: "gpu", name: "审核测试显卡", aliases: [], spec, source: "manual", manufacturer: "MSI" },
  ]);
}

function seedSource(status: "unreviewed" | "verified" = "unreviewed") {
  return service.addReviewSource({
    canonicalProductId: GPU_ID,
    sourceType: "manufacturer",
    tier: "S1",
    sourceUrl: "https://www.msi.com/example/spec",
    sourceTitle: "微星规格页",
    contentHash: "a1b2c3d4e5f7",
    reviewer: "reviewer-a",
    capturedAt: "2026-09-29T00:00:00.000Z",
    ...(status === "verified" ? {} : {}),
  });
}

describe("目录审核服务", () => {
  it("无 reviewer 署名的写操作一律拒绝（Agent 无权变更产品事实）", async () => {
    seedGpu();
    const { addReviewSource: addSource } = await import("@/application/catalog-review/service");
    expect(() =>
      addSource({
        canonicalProductId: GPU_ID,
        sourceType: "manufacturer",
        tier: "S1",
        sourceUrl: "https://example.com/x",
        sourceTitle: "无署名来源",
        contentHash: "a1b2c3d4e5f8",
        reviewer: "  ",
      }),
    ).toThrow(/reviewer/);

    const queue = service.listCatalogQueue();
    expect(Array.isArray(queue)).toBe(true);
  });

  it("添加来源 + 录入证据：字段从 unknown 变 supported（未复核封顶），事件留痕", () => {
    const source = seedSource();
    expect(source.status).toBe("unreviewed");

    const { field } = service.addReviewEvidence({
      canonicalProductId: GPU_ID,
      fieldPath: "spec.lengthMm",
      sourceId: source.id,
      value: 336,
      excerpt: "规格页：显卡长度 336mm",
      identityMatch: "mpn_exact",
      reviewer: "reviewer-a",
    });
    expect(field.status).toBe("supported");

    const events = listQualityEvents(GPU_ID);
    const corrected = events.find((event) => event.eventType === "corrected");
    expect(corrected?.actor).toBe("reviewer:reviewer-a");
    expect(corrected?.afterJson).toMatchObject({ lengthMm: "supported" });
  });

  it("人工复核证据：盖章后字段 verified、来源转 verified；四个必填字段全核验后 publish 才 verified", () => {
    seedGpu({ tdpWatts: 220, lengthMm: 336, pcie8pin: 2, twelveVhpwr: 0 });
    const source = seedSource();
    const fieldValues: Array<[string, unknown]> = [
      ["spec.lengthMm", 336],
      ["spec.tdpWatts", 220],
      ["spec.pcie8pin", 2],
      ["spec.twelveVhpwr", 0],
    ];
    const evidenceIds: string[] = [];
    for (const [fieldPath, value] of fieldValues) {
      const { evidence } = service.addReviewEvidence({
        canonicalProductId: GPU_ID,
        fieldPath,
        sourceId: source.id,
        value,
        excerpt: `规格页：${fieldPath}=${String(value)}`,
        identityMatch: "mpn_exact",
        reviewer: "reviewer-a",
      });
      evidenceIds.push(evidence.id);
    }
    // 一个字段核验前：其余字段已有未复核证据（supported），产品级封顶 supported
    const partial = service.verifyReviewEvidence({ evidenceId: evidenceIds[0]!, reviewer: "reviewer-b" });
    expect(partial.fields.lengthMm?.status).toBe("verified");
    expect(partial.productStatus).toBe("supported");

    for (const evidenceId of evidenceIds.slice(1)) {
      service.verifyReviewEvidence({ evidenceId, reviewer: "reviewer-b" });
    }
    const published = service.publishProduct({ canonicalProductId: GPU_ID, reviewer: "reviewer-b", note: "首次发布" });
    expect(published.productStatus).toBe("verified");
    const record = repo.listCatalogRecords({ category: "gpu" }).find((row) => row.id === GPU_ID);
    expect(record?.qualityStatus).toBe("verified");

    const reviewed = listQualityEvents(GPU_ID).filter((event) => event.eventType === "reviewed");
    expect(reviewed.length).toBeGreaterThanOrEqual(2);
    expect(reviewed[0]?.afterJson).toMatchObject({ productStatus: "verified" });
  });

  it("没有证据链的字段 publish 也 verified 不了（发布只是重算落库，不引入事实）", () => {
    seedGpu({ tdpWatts: 220 }, );
    repo.upsertCatalogEntries([
      { id: "gpu-review-2", category: "gpu", name: "无证据显卡", aliases: [], spec: { tdpWatts: 160 }, source: "buildcores" },
    ]);
    const published = service.publishProduct({ canonicalProductId: "gpu-review-2", reviewer: "reviewer-a" });
    expect(published.fields.lengthMm?.status).toBe("unknown");
    expect(published.productStatus).toBe("partial");
  });

  it("驳回来源：其证据作废，字段回到 rejected；标记过期把产品置 stale", () => {
    repo.upsertCatalogEntries([
      { id: GPU_ID_2, category: "gpu", name: "驳回测试卡", aliases: [], spec: { tdpWatts: 220, lengthMm: 336 }, source: "manual" },
    ]);
    const source = service.addReviewSource({
      canonicalProductId: GPU_ID_2,
      sourceType: "manufacturer",
      tier: "S1",
      sourceUrl: "https://www.msi.com/example/reject-spec",
      sourceTitle: "驳回测试来源",
      contentHash: "b1b2c3d4e5f7",
      reviewer: "reviewer-a",
    });
    const { evidence } = service.addReviewEvidence({
      canonicalProductId: GPU_ID_2,
      fieldPath: "spec.lengthMm",
      sourceId: source.id,
      value: 336,
      excerpt: "规格页：显卡长度 336mm",
      identityMatch: "mpn_exact",
      reviewer: "reviewer-a",
    });
    service.verifyReviewEvidence({ evidenceId: evidence.id, reviewer: "reviewer-b" });
    expect(service.computeProductFieldStatuses(GPU_ID_2).fields.lengthMm?.status).toBe("verified");

    service.reviewSourceStatus({ sourceId: source.id, status: "rejected", reviewer: "reviewer-b", note: "页面非该变体" });
    expect(service.computeProductFieldStatuses(GPU_ID_2).fields.lengthMm?.status).toBe("rejected");

    service.markProductStale({ canonicalProductId: GPU_ID_2, reviewer: "reviewer-b", reason: "官方页改版" });
    const record = repo.listCatalogRecords({ category: "gpu" }).find((row) => row.id === GPU_ID_2);
    expect(record?.qualityStatus).toBe("stale");
    expect(listProductSources(GPU_ID_2).every((item) => item.status === "rejected" || item.status === "stale")).toBe(true);
  });

  it("发布把采用值补缺写回 spec；已有值不被覆盖", () => {
    repo.upsertCatalogEntries([
      // lengthMm 已有值 300（不得被证据 290 覆盖）；pcie8pin 缺失（由证据补上）
      { id: "gpu-publish-1", category: "gpu", name: "发布补缺测试卡", aliases: [], spec: { tdpWatts: 220, lengthMm: 300 }, source: "manual" },
    ]);
    const source = service.addReviewSource({
      canonicalProductId: "gpu-publish-1",
      sourceType: "manufacturer",
      tier: "S1",
      sourceUrl: "https://example.com/publish-spec",
      sourceTitle: "发布补缺来源",
      contentHash: "c1b2c3d4e5f7",
      reviewer: "reviewer-a",
    });
    service.addReviewEvidence({ canonicalProductId: "gpu-publish-1", fieldPath: "spec.lengthMm", sourceId: source.id, value: 290, excerpt: "长度 290mm", identityMatch: "mpn_exact", reviewer: "reviewer-a" });
    service.addReviewEvidence({ canonicalProductId: "gpu-publish-1", fieldPath: "spec.pcie8pin", sourceId: source.id, value: 0, excerpt: "16pin 供电无 8pin", identityMatch: "mpn_exact", reviewer: "reviewer-a" });

    const report = service.publishProduct({ canonicalProductId: "gpu-publish-1", reviewer: "reviewer-b" });
    const record = repo.listCatalogRecords({ category: "gpu" }).find((row) => row.id === "gpu-publish-1");
    expect(record?.spec.lengthMm).toBe(300); // 已有值不覆盖
    expect(record?.spec.pcie8pin).toBe(0);   // 缺失字段由证据补上
    expect(record?.qualityStatus).toBe("partial"); // 还有必填字段无证据 → unknown → partial
    expect(report.fields.pcie8pin?.status).toBe("supported");
  });

  it("合并去重：证据来源改挂保留条目、补缺、旧 id 记 merged_into 且不再进候选", () => {
    repo.upsertCatalogEntries([
      { id: "gpu-keep", category: "gpu", name: "保留卡", aliases: [], spec: { tdpWatts: 220 }, source: "manual" },
      { id: "gpu-dup", category: "gpu", name: "重复卡（大小写差异）", aliases: [], spec: { lengthMm: 336 }, source: "manual" },
    ]);
    const source = service.addReviewSource({
      canonicalProductId: "gpu-dup",
      sourceType: "manufacturer",
      tier: "S1",
      sourceUrl: "https://example.com/dup",
      sourceTitle: "重复卡来源",
      contentHash: "a1b2c3d4e5f9",
      reviewer: "reviewer-a",
    });
    const { evidence } = service.addReviewEvidence({
      canonicalProductId: "gpu-dup",
      fieldPath: "spec.lengthMm",
      sourceId: source.id,
      value: 336,
      excerpt: "重复卡长度 336mm",
      identityMatch: "mpn_exact",
      reviewer: "reviewer-a",
    });
    service.verifyReviewEvidence({ evidenceId: evidence.id, reviewer: "reviewer-b" });

    const report = service.mergeProducts({
      keepId: "gpu-keep",
      duplicateId: "gpu-dup",
      reviewer: "reviewer-b",
      reason: "同厂商同 MPN 大小写差异",
    });
    expect(report.fields.lengthMm?.status).toBe("verified");

    const keep = repo.listCatalogRecords({ category: "gpu" }).find((row) => row.id === "gpu-keep");
    expect(keep?.spec.lengthMm).toBe(336);
    // 旧 id 不再出现在候选里
    expect(repo.loadCatalogEntries().some((entry) => entry.id === "gpu-dup")).toBe(false);
    // 但旧 id 仍可解析出保留条目（merged_into 映射）
    const snapshot = repo.getCatalogSnapshot("gpu-dup");
    expect(snapshot?.mergedInto).toBe("gpu-keep");
    // 事件双侧留痕
    expect(listQualityEvents("gpu-keep").some((event) => event.eventType === "merged")).toBe(true);
    expect(listQualityEvents("gpu-dup").some((event) => event.eventType === "deprecated")).toBe(true);
  });

  it("非法合并被拒绝：跨类别、自合并、无原因", () => {
    repo.upsertCatalogEntries([
      { id: "cpu-keep", category: "cpu", name: "CPU 保留", aliases: [], spec: { socket: "AM5" }, source: "manual" },
    ]);
    expect(() =>
      service.mergeProducts({ keepId: "gpu-keep", duplicateId: "cpu-keep", reviewer: "r", reason: "x" }),
    ).toThrow(/类别不同/);
    expect(() =>
      service.mergeProducts({ keepId: "gpu-keep", duplicateId: "gpu-keep", reviewer: "r", reason: "x" }),
    ).toThrow(/自己/);
    expect(() =>
      service.mergeProducts({ keepId: "gpu-keep", duplicateId: "cpu-keep", reviewer: "r", reason: " " }),
    ).toThrow(/原因/);
  });

  it("队列：创建、流转、终态与事件署名", () => {
    const item = service.createCatalogQueueItem({
      queueType: "new_product",
      category: "gpu",
      userInput: "4070s ventus 白色",
      candidateCanonicalIds: [],
      missingFields: [],
      priority: "normal",
      reason: "用户搜索未命中目录",
    });
    service.updateCatalogQueueItem(item.id, { status: "processing", assignedTo: "reviewer-a", reviewer: "reviewer-a" });
    const resolved = service.updateCatalogQueueItem(item.id, { status: "resolved", reviewer: "reviewer-a", resolutionNote: "已建条目" });
    expect(resolved.status).toBe("resolved");

    const open = service.listCatalogQueue({ status: "open" });
    expect(open.some((queueItem) => queueItem.id === item.id)).toBe(false);

    expect(() => service.createCatalogQueueItem({ queueType: "stale", category: "gpu", userInput: null, candidateCanonicalIds: [], missingFields: [], priority: "low", reason: "" })).toThrow(/原因/);
  });
});
