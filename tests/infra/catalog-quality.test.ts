import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// 目录数据质量仓储（v8）：独立临时库，验证迁移幂等、追加式证据、状态机与持久化
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-catalog-quality-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "quality.db");
process.env.RIGMATE_BUILDCORES_CATALOG_PATH = join(tempDir, "no-buildcores.json");
process.env.RIGMATE_MANUAL_CATALOG_PATH = join(tempDir, "no-manual.json");

const repo = await import("@/infra/db/repositories/catalog-repository");
const evidenceRepo = await import("@/infra/db/repositories/evidence-repository");
const qualityRepo = await import("@/infra/db/repositories/quality-repository");
const { closeDatabase, ensureDatabase } = await import("@/infra/db/client");
const { migrateSchema, readSchemaVersion } = await import("@/infra/db/migrate");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

const gpuId = "gpu-quality-1";

function seedProduct(overrides: Record<string, unknown> = {}) {
  repo.upsertCatalogEntries([
    {
      id: gpuId,
      category: "gpu",
      name: "微星 RTX 4070 SUPER VENTUS 测试卡",
      aliases: ["测试卡"],
      spec: { tdpWatts: 220 },
      source: "manual",
      manufacturer: "MSI",
      series: "GeForce RTX 4070 SUPER",
      model: "GeForce RTX 4070 SUPER 12G VENTUS 2X",
      variant: "Ventus 2X",
      mpn: null,
      ...overrides,
    },
  ]);
}

function addSource(status: "unreviewed" | "verified" = "unreviewed") {
  return evidenceRepo.addProductSource({
    canonicalProductId: gpuId,
    sourceType: "manufacturer",
    tier: "S1",
    sourceUrl: "https://www.msi.com/example-gpu/spec",
    sourceTitle: "微星规格页",
    sourceVersion: null,
    license: null,
    capturedAt: "2026-09-29T00:00:00.000Z",
    contentHash: "a1b2c3d4e5f6",
    status,
    reviewerNote: null,
  });
}

describe("目录数据质量仓储（v8/v9 迁移 + 证据/事件/队列）", () => {
  it("迁移幂等：重复执行不再产生新步骤，版本停在 v9", () => {
    const db = ensureDatabase();
    expect(readSchemaVersion(db)).toBe(9);
    const second = migrateSchema(db);
    expect(second.applied).toEqual([]);
    expect(second.from).toBe(9);
  });

  it("证据追加式：同字段冲突证据并存，旧证据不被覆盖", () => {
    seedProduct();
    const source = addSource();
    evidenceRepo.addFieldEvidence({
      canonicalProductId: gpuId,
      fieldPath: "spec.lengthMm",
      sourceId: source.id,
      value: 400,
      excerpt: "显卡长度 400mm",
      identityMatch: "mpn_exact",
      confidence: "high",
      verifiedAt: null,
      verifiedBy: null,
      supersedesId: null,
    });
    evidenceRepo.addFieldEvidence({
      canonicalProductId: gpuId,
      fieldPath: "spec.lengthMm",
      sourceId: source.id,
      value: 397,
      excerpt: "实测长度 397mm",
      identityMatch: "mpn_exact",
      confidence: "medium",
      verifiedAt: null,
      verifiedBy: null,
      supersedesId: null,
    });

    const rows = evidenceRepo.listFieldEvidence(gpuId, "spec.lengthMm");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.value).sort()).toEqual([397, 400]);
  });

  it("错误单位与未知字段在门口被拒绝", () => {
    const source = addSource();
    expect(() =>
      evidenceRepo.addFieldEvidence({
        canonicalProductId: gpuId,
        fieldPath: "spec.lengthMm",
        sourceId: source.id,
        value: "约 400mm",
        excerpt: "长度约 400mm",
        identityMatch: "mpn_exact",
        confidence: "high",
        verifiedAt: null,
        verifiedBy: null,
        supersedesId: null,
      }),
    ).toThrow(/schema/);

    expect(() =>
      evidenceRepo.addFieldEvidence({
        canonicalProductId: gpuId,
        fieldPath: "spec.color",
        sourceId: source.id,
        value: "white",
        excerpt: "颜色",
        identityMatch: "mpn_exact",
        confidence: "high",
        verifiedAt: null,
        verifiedBy: null,
        supersedesId: null,
      }),
    ).toThrow();
  });

  it("来源审核状态机：正常流转放行，回退与终态复活抛错", () => {
    const source = addSource("unreviewed");
    const verified = evidenceRepo.transitionProductSourceStatus(source.id, "verified", "已人工复核");
    expect(verified.status).toBe("verified");

    expect(() => evidenceRepo.transitionProductSourceStatus(source.id, "unreviewed")).toThrow(/非法/);
    const stale = evidenceRepo.transitionProductSourceStatus(source.id, "stale");
    expect(stale.status).toBe("stale");
  });

  it("质量事件只增不改，按时间倒序读取", () => {
    qualityRepo.appendQualityEvent({
      canonicalProductId: gpuId,
      eventType: "imported",
      beforeJson: null,
      afterJson: { source: "manual" },
      reason: "人工目录导入",
      actor: "import:manual",
    });
    qualityRepo.appendQualityEvent({
      canonicalProductId: gpuId,
      eventType: "conflict",
      beforeJson: { lengthMm: 400 },
      afterJson: null,
      reason: "BuildCores 397 与厂商页 400 冲突",
      actor: "import:buildcores",
    });
    const events = qualityRepo.listQualityEvents(gpuId);
    expect(events).toHaveLength(2);
    expect(events[0]?.eventType).toBe("conflict");
    expect(() =>
      qualityRepo.appendQualityEvent({
        canonicalProductId: "no-such-product",
        eventType: "reviewed",
        beforeJson: null,
        afterJson: null,
        reason: "x",
        actor: "test",
      }),
    ).toThrow(/产品不存在/);
  });

  it("队列状态流转：open → processing → resolved 落 resolvedAt；终态复活抛错", () => {
    const item = qualityRepo.createQueueItem({
      queueType: "missing_field",
      category: "gpu",
      userInput: null,
      candidateCanonicalIds: [gpuId],
      missingFields: ["lengthMm", "pcie8pin"],
      priority: "high",
      reason: "关键缺失字段阻塞兼容规则",
    });
    expect(item.status).toBe("open");

    qualityRepo.updateQueueItem(item.id, { status: "processing", assignedTo: "reviewer-a" });
    const open = qualityRepo.listQueueItems({ status: "open" });
    expect(open.some((queueItem) => queueItem.id === item.id)).toBe(false);

    const resolved = qualityRepo.updateQueueItem(item.id, {
      status: "resolved",
      resolutionNote: "已录入厂商页证据",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).not.toBeNull();
    expect(() => qualityRepo.updateQueueItem(item.id, { status: "open" })).toThrow(/非法/);
  });

  it("new_product 队列项允许指向尚不存在的产品；其余类型必须指向存在的产品", () => {
    const created = qualityRepo.createQueueItem({
      queueType: "new_product",
      category: "gpu",
      userInput: "4070s ventus 白色",
      candidateCanonicalIds: [],
      missingFields: [],
      priority: "normal",
      reason: "用户搜索未命中目录",
    });
    expect(created.status).toBe("open");

    expect(() =>
      qualityRepo.createQueueItem({
        queueType: "stale",
        category: "gpu",
        userInput: null,
        candidateCanonicalIds: ["no-such-id"],
        missingFields: [],
        priority: "low",
        reason: "来源过期",
      }),
    ).toThrow(/产品不存在/);
  });

  it("canonical_products 身份列与质量状态筛选", () => {
    // first-wins：此处用全新 id，避免被前序用例先插入的 partial 行占用
    repo.upsertCatalogEntries([
      {
        id: "gpu-quality-verified",
        category: "gpu",
        name: "已核验测试卡",
        aliases: [],
        spec: { tdpWatts: 220 },
        source: "manual",
        manufacturer: "MSI",
        qualityStatus: "verified",
        sourceVersion: "manual-2026-09",
      },
      {
        id: "gpu-quality-partial",
        category: "gpu",
        name: "未核验测试卡",
        aliases: [],
        spec: { tdpWatts: 180 },
        source: "manual",
        manufacturer: "ASUS",
      },
    ]);

    const verified = repo.listCatalogRecords({ qualityStatus: "verified" });
    const verifiedRow = verified.find((record) => record.id === "gpu-quality-verified");
    expect(verifiedRow?.sourceVersion).toBe("manual-2026-09");
    expect(verifiedRow?.mpn).toBeNull();

    const partial = repo.listCatalogRecords({ qualityStatus: "partial", category: "gpu" });
    const partialRow = partial.find((record) => record.id === "gpu-quality-partial");
    expect(partialRow?.qualityStatus).toBe("partial");
    expect(partialRow?.manufacturer).toBe("ASUS");
  });

  it("重启后数据持久化（close → reopen）", () => {
    closeDatabase();
    // ensureDatabase 会按 RIGMATE_DB_PATH 重新建连并跑幂等迁移
    const rows = evidenceRepo.listFieldEvidence(gpuId, "spec.lengthMm");
    expect(rows).toHaveLength(2);
    expect(readSchemaVersion(ensureDatabase())).toBe(9);
  });
});
