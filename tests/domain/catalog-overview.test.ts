import { describe, expect, it } from "vitest";
import { buildCatalogOverview, type SourceInput } from "@/domain/catalog/overview";
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
