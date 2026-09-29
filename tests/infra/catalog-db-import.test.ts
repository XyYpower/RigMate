import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { BuildcoresBatchProvenance } from "@/infra/catalog-import/db-import";

// BuildCores → canonical_products 审计合并（Task 3）：补缺不覆盖、冲突留痕降级、来源与证据落库
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-db-import-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "db-import.db");
process.env.RIGMATE_BUILDCORES_CATALOG_PATH = join(tempDir, "no-buildcores.json");
process.env.RIGMATE_MANUAL_CATALOG_PATH = join(tempDir, "no-manual.json");

const { upsertCatalogEntries, listCatalogRecords } = await import("@/infra/db/repositories/catalog-repository");
const { importBuildcoresBatch } = await import("@/infra/catalog-import/db-import");
const { listFieldEvidence, listProductSources } = await import("@/infra/db/repositories/evidence-repository");
const { listQualityEvents } = await import("@/infra/db/repositories/quality-repository");
const { closeDatabase } = await import("@/infra/db/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

const PROVENANCE: BuildcoresBatchProvenance = {
  upstreamCommit: "a".repeat(40),
  upstreamUrl: "https://github.com/buildcores/buildcores-open-db",
  license: "ODC-By 1.0",
  sourcePath: "data/catalog/buildcores.json",
};

describe("importBuildcoresBatch（审计合并）", () => {
  it("新建条目 partial 起步并落 imported 事件；不落逐字段证据", () => {
    const report = importBuildcoresBatch(
      [{ id: "bc-new-gpu-1", category: "gpu", name: "BuildCores 新显卡", aliases: [], spec: { tdpWatts: 220 } }],
      PROVENANCE,
    );
    expect(report.inserted).toBe(1);
    expect(report.eventsAppended).toBe(1);

    const record = listCatalogRecords({ category: "gpu" }).find((row) => row.id === "bc-new-gpu-1");
    expect(record?.qualityStatus).toBe("partial");
    expect(record?.sourceVersion).toBe(PROVENANCE.upstreamCommit);
    expect(listQualityEvents("bc-new-gpu-1")).toHaveLength(1);
    expect(listFieldEvidence("bc-new-gpu-1")).toHaveLength(0);
  });

  it("已有条目只补缺：缺失字段落证据，已有字段一致不动", () => {
    upsertCatalogEntries([
      {
        id: "gpu-audit-1",
        category: "gpu",
        name: "已有人工显卡",
        aliases: [],
        spec: { tdpWatts: 220, lengthMm: 336 },
        source: "manual",
      },
    ]);
    const report = importBuildcoresBatch(
      [{ id: "gpu-audit-1", category: "gpu", name: "已有人工显卡", aliases: [], spec: { tdpWatts: 220, lengthMm: 336, pcie8pin: 2, twelveVhpwr: 0 } }],
      PROVENANCE,
    );
    expect(report.filledFields).toBe(2);
    expect(report.unchangedFields).toBe(2);
    expect(report.conflictedFields).toBe(0);
    expect(report.sourcesCreated).toBe(1);

    const record = listCatalogRecords({ category: "gpu" }).find((row) => row.id === "gpu-audit-1");
    expect(record?.spec.pcie8pin).toBe(2);
    expect(record?.spec.tdpWatts).toBe(220);

    const evidence = listFieldEvidence("gpu-audit-1", "spec.pcie8pin");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.value).toBe(2);
    expect(evidence[0]?.identityMatch).toBe("fields_matched");

    const sources = listProductSources("gpu-audit-1");
    expect(sources).toHaveLength(1);
    expect(sources[0]?.tier).toBe("S2");
    expect(sources[0]?.status).toBe("unreviewed");
    expect(sources[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("冲突不覆盖：库内值保留、上游值作为证据留痕、产品降级 conflicting", () => {
    upsertCatalogEntries([
      {
        id: "gpu-audit-2",
        category: "gpu",
        name: "冲突测试卡",
        aliases: [],
        spec: { tdpWatts: 220 },
        source: "manual",
      },
    ]);
    const report = importBuildcoresBatch(
      [{ id: "gpu-audit-2", category: "gpu", name: "冲突测试卡", aliases: [], spec: { tdpWatts: 999 } }],
      PROVENANCE,
    );
    expect(report.conflictedFields).toBe(1);
    expect(report.conflictedProducts).toBe(1);

    // 库内值不被覆盖
    const record = listCatalogRecords({ category: "gpu" }).find((row) => row.id === "gpu-audit-2");
    expect(record?.spec.tdpWatts).toBe(220);
    expect(record?.qualityStatus).toBe("conflicting");

    // 上游值作为证据 + conflict 质量事件留痕
    const evidence = listFieldEvidence("gpu-audit-2", "spec.tdpWatts");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.value).toBe(999);
    const events = listQualityEvents("gpu-audit-2");
    const conflict = events.find((event) => event.eventType === "conflict");
    expect(conflict?.beforeJson).toEqual({ tdpWatts: 220 });
    expect(conflict?.afterJson).toEqual({ tdpWatts: 999 });
  });

  it("坏值在门口被拒绝：负数长度不计入补缺也不落证据", () => {
    upsertCatalogEntries([
      {
        id: "gpu-audit-3",
        category: "gpu",
        name: "坏值测试卡",
        aliases: [],
        spec: { tdpWatts: 115 },
        source: "manual",
      },
    ]);
    const report = importBuildcoresBatch(
      [{ id: "gpu-audit-3", category: "gpu", name: "坏值测试卡", aliases: [], spec: { lengthMm: -400 } } as never],
      PROVENANCE,
    );
    expect(report.rejectedFields).toBe(1);
    expect(report.filledFields).toBe(0);
    expect(listFieldEvidence("gpu-audit-3")).toHaveLength(0);
    const record = listCatalogRecords({ category: "gpu" }).find((row) => row.id === "gpu-audit-3");
    expect(record?.spec.lengthMm).toBeUndefined();
    expect(record?.qualityStatus).toBe("partial");
  });
});
