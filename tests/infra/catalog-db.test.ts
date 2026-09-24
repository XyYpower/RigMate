import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// 自有规格库（M29）：独立临时库；JSON 目录源指向不存在路径，保证测的是"查库"而不是兜底
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-catalog-db-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "catalog.db");
process.env.RIGMATE_BUILDCORES_CATALOG_PATH = join(tempDir, "no-buildcores.json");
process.env.RIGMATE_MANUAL_CATALOG_PATH = join(tempDir, "no-manual.json");

const repo = await import("@/infra/db/repositories/catalog-repository");
const { loadSourcedCatalog, resetBuildcoresCatalogCacheForTests } = await import(
  "@/infra/catalog-import/load"
);
const { closeDatabase } = await import("@/infra/db/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

const seedCpu = {
  id: "cpu-test-1",
  category: "cpu" as const,
  name: "测试 CPU A",
  aliases: ["测试A"],
  spec: { socket: "AM5" },
};

describe("自有规格库仓储（canonical_products）", () => {
  it("首次入库 first-wins：同 id 人工源不覆盖种子源", () => {
    const first = repo.upsertCatalogEntries([{ ...seedCpu, source: "seed" }]);
    expect(first).toEqual({ inserted: 1, skipped: 0 });

    const second = repo.upsertCatalogEntries([
      { ...seedCpu, name: "被覆盖的名字", source: "manual" },
      {
        id: "mb-test-1",
        category: "motherboard",
        name: "测试主板 B",
        aliases: [],
        spec: { socket: "AM5", ramType: "DDR5", formFactor: "ATX" },
        source: "manual",
      },
    ]);
    expect(second).toEqual({ inserted: 1, skipped: 1 });

    const entries = repo.loadCatalogEntries();
    const cpu = entries.find((entry) => entry.id === "cpu-test-1");
    expect(cpu?.source).toBe("seed");
    expect(cpu?.name).toBe("测试 CPU A");
  });

  it("读取顺序：来源优先级（种子→人工→BuildCores）先于名称排序", () => {
    repo.upsertCatalogEntries([
      {
        id: "cpu-test-2",
        category: "cpu",
        name: "AAAA 排在最前的名字",
        aliases: [],
        spec: { socket: "AM5" },
        source: "manual",
      },
    ]);
    const entries = repo.loadCatalogEntries();
    const cpuEntries = entries.filter((entry) => entry.category === "cpu");
    // 种子（cpu-test-1）在前，尽管人工条目名字典序更小
    expect(cpuEntries.map((entry) => entry.id)).toEqual(["cpu-test-1", "cpu-test-2"]);
  });

  it("补缺更新只填空位：已核字段与已设 refUrl 不被覆盖", () => {
    repo.upsertCatalogEntries([
      {
        id: "gpu-test-1",
        category: "gpu",
        name: "测试显卡 C",
        aliases: ["测试C"],
        spec: { tdpWatts: 220 },
        source: "manual",
        refUrl: "https://example.com/origin",
      },
    ]);

    const report = repo.mergeCatalogUpdates([
      {
        id: "gpu-test-1",
        specPatch: { tdpWatts: 999, lengthMm: 336 },
        refUrl: "https://example.com/new",
        aliases: ["新别名"],
      },
    ]);
    expect(report.updated).toBe(1);
    expect(report.missingIds).toEqual([]);

    const gpu = repo.loadCatalogEntries().find((entry) => entry.id === "gpu-test-1");
    expect(gpu?.spec.tdpWatts).toBe(220); // 已核字段不覆盖
    expect(gpu?.spec.lengthMm).toBe(336); // 缺失字段补上
    expect(gpu?.refUrl).toBe("https://example.com/origin"); // 已设链接不覆盖
    expect(gpu?.aliases).toContain("新别名");
  });

  it("补缺更新：不存在的 id 进报告而不是静默创建；坏补丁整条拒绝", () => {
    const report = repo.mergeCatalogUpdates([
      { id: "no-such-id", specPatch: { tdpWatts: 100 } },
    ]);
    expect(report.missingIds).toEqual(["no-such-id"]);
    expect(report.updated).toBe(0);

    repo.upsertCatalogEntries([
      {
        id: "psu-test-1",
        category: "psu",
        name: "测试电源 D",
        aliases: [],
        spec: { ratedWatts: 750 },
        source: "manual",
      },
    ]);
    // 负数额定功率不符合 schema：合并结果整体校验，直接抛错且不落库
    expect(() =>
      repo.mergeCatalogUpdates([{ id: "psu-test-1", specPatch: { ratedWatts: -100 } }]),
    ).toThrow();
    const psu = repo.loadCatalogEntries().find((entry) => entry.id === "psu-test-1");
    expect(psu?.spec.ratedWatts).toBe(750);
  });

  it("loadSourcedCatalog：库非空时走查库并保留来源与 refUrl", () => {
    resetBuildcoresCatalogCacheForTests();
    const sourced = loadSourcedCatalog();
    expect(sourced.dbBacked).toBe(true);
    expect(sourced.entries.length).toBeGreaterThanOrEqual(5);
    expect(sourced.entries.some((entry) => entry.source === "seed")).toBe(true);
    const gpu = sourced.entries.find((entry) => entry.id === "gpu-test-1");
    expect(gpu?.refUrl).toBe("https://example.com/origin");
  });

  it("写入前校验：不符合类别 schema 的条目拒绝入库", () => {
    expect(() =>
      repo.upsertCatalogEntries([
        {
          id: "ram-test-bad",
          category: "ram",
          name: "坏内存",
          aliases: [],
          spec: { sticks: -1 },
          source: "manual",
        },
      ]),
    ).toThrow();
  });
});
