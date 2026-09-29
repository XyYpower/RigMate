import { describe, expect, it } from "vitest";
import { buildCatalogOverview, buildQualityOverview, type SourceInput } from "@/domain/catalog/overview";
import type { CatalogEntry } from "@/domain/catalog/seed";

function entry(id: string, category: CatalogEntry["category"], spec: Record<string, unknown>): CatalogEntry {
  return { id, category, name: id, aliases: [], spec };
}

const sources: SourceInput[] = [
  {
    key: "seed",
    label: "人工种子",
    entries: [entry("cpu-1", "cpu", { socket: "AM5" }), entry("psu-1", "psu", {})],
    importedAt: null,
    note: null,
    attribution: null,
  },
  {
    key: "manual",
    label: "人工整理",
    entries: [entry("m-1", "cpu", {}), entry("m-2", "case", { maxGpuLengthMm: 400 })],
    importedAt: "2026-09-22T00:00:00.000Z",
    note: "人工整理",
    attribution: null,
  },
  {
    key: "buildcores",
    label: "BuildCores",
    entries: [entry("bc-1", "gpu", { lengthMm: 249 }), entry("bc-2", "gpu", {})],
    importedAt: "2026-09-21T00:00:00.000Z",
    note: null,
    attribution: { upstreamCommit: "a".repeat(40), upstreamUrl: "x", license: "ODC-By 1.0", licenseUrl: "x" },
  },
];

describe("硬件中心目录总览（buildCatalogOverview）", () => {
  it("按类别聚合计数与规格覆盖，来源分列", () => {
    const overview = buildCatalogOverview(sources);
    expect(overview.totalEntries).toBe(6);
    expect(overview.sources.map((s) => s.count)).toEqual([2, 2, 2]);
    expect(overview.sources[2]?.attribution?.license).toBe("ODC-By 1.0");

    const cpu = overview.categories.find((c) => c.category === "cpu");
    expect(cpu).toEqual({ category: "cpu", total: 2, withSpec: 1, bySource: { seed: 1, manual: 1, buildcores: 0 } });

    const gpu = overview.categories.find((c) => c.category === "gpu");
    expect(gpu?.withSpec).toBe(1);
    expect(gpu?.bySource.buildcores).toBe(2);
  });

  it("空目录来源照常参与总览（未导入 BuildCores 的全新环境）", () => {
    const overview = buildCatalogOverview([
      { key: "seed", label: "人工种子", entries: [entry("cpu-1", "cpu", {})], importedAt: null, note: null, attribution: null },
      { key: "manual", label: "人工整理", entries: [], importedAt: null, note: null, attribution: null },
      { key: "buildcores", label: "BuildCores", entries: [], importedAt: null, note: null, attribution: null },
    ]);
    expect(overview.totalEntries).toBe(1);
    expect(overview.categories[0]?.withSpec).toBe(0);
    expect(overview.sources[1]?.count).toBe(0);
  });
});

describe("buildQualityOverview（Task 6 只读质量报表）", () => {
  const records = [
    { category: "gpu" as const, spec: { lengthMm: 336, tdpWatts: 220, pcie8pin: 0, twelveVhpwr: 1 }, source: "manual", qualityStatus: "verified" as const },
    { category: "gpu" as const, spec: { tdpWatts: 160 }, source: "buildcores", qualityStatus: "partial" as const },
    { category: "case" as const, spec: { supportedFormFactors: ["ATX"] }, source: "seed", qualityStatus: "conflicting" as const },
  ];
  const queueItems = [
    { queueType: "missing_field" as const, status: "open" as const, missingFields: ["lengthMm"] },
    { queueType: "missing_field" as const, status: "open" as const, missingFields: ["lengthMm", "pcie8pin"] },
    { queueType: "new_product" as const, status: "open" as const, missingFields: [] },
    { queueType: "stale" as const, status: "resolved" as const, missingFields: [] },
  ];

  it("统计质量状态分布、来源分层、关键字段完整率与冲突/过期率", () => {
    const overview = buildQualityOverview({
      records,
      queueItems,
      evidence: { total: 5, verified: 2, productsWithEvidence: 1, productFieldPairs: 4 },
    });
    expect(overview.products.total).toBe(3);
    expect(overview.products.byQualityStatus).toMatchObject({ verified: 1, partial: 1, conflicting: 1 });
    expect(overview.bySource).toEqual({ manual: 1, buildcores: 1, seed: 1 });
    const gpu = overview.categories.find((row) => row.category === "gpu");
    // gpu 必填 4 字段 × 2 条 = 8，已填 4 + 1 = 5
    expect(gpu).toMatchObject({ total: 2, filledFields: 5, totalFields: 8, fillRate: 63 });
    expect(overview.conflicts).toEqual({ products: 1, rate: 33.3 });
    expect(overview.stale).toEqual({ products: 0, rate: 0 });
    expect(overview.evidence.productCoverageRate).toBe(33);
  });

  it("队列只统计 open 项，阻塞字段按次数排序", () => {
    const overview = buildQualityOverview({
      records,
      queueItems,
      evidence: { total: 0, verified: 0, productsWithEvidence: 0, productFieldPairs: 0 },
    });
    expect(overview.queue.open).toBe(3);
    expect(overview.queue.byType).toMatchObject({ missing_field: 2, new_product: 1, stale: 0 });
    expect(overview.queue.topBlockingFields).toEqual([
      { field: "lengthMm", count: 2 },
      { field: "pcie8pin", count: 1 },
    ]);
    expect(overview.evidence.productCoverageRate).toBe(0);
  });

  it("空目录时比率归零而不是 NaN", () => {
    const overview = buildQualityOverview({
      records: [],
      queueItems: [],
      evidence: { total: 0, verified: 0, productsWithEvidence: 0, productFieldPairs: 0 },
    });
    expect(overview.products.total).toBe(0);
    expect(overview.evidence.productCoverageRate).toBe(0);
    expect(overview.conflicts.rate).toBe(0);
    expect(overview.queue.topBlockingFields).toEqual([]);
  });
});
