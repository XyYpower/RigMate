import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MANUAL_CSV_HEADERS,
  mergeManualEntries,
  normalizeFormFactorLoose,
  normalizeSocketValue,
  parseCsv,
  rowToEntry,
} from "@/infra/catalog-import/manual-csv";

function csvRow(cells: Record<string, string>): string[] {
  return MANUAL_CSV_HEADERS.map((header) => cells[header] ?? "");
}

function entryFrom(cells: Record<string, string>) {
  const outcome = rowToEntry(csvRow(cells));
  if (outcome.status !== "ok") throw new Error(outcome.errors.join("；"));
  return outcome.entry;
}

describe("人工目录 CSV（M20）", () => {
  it("parseCsv：处理引号内逗号、转义引号、BOM 与 CRLF", () => {
    const csv = '\uFEFF型号（必填）,别名（检索用，分号分隔）\r\n"火神, 32G","a""b；c"\r\n';
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["型号（必填）", "别名（检索用，分号分隔）"]);
    expect(rows[1]).toEqual(["火神, 32G", 'a"b；c']);
  });

  it("归一化：LGA 1700→LGA1700、micro atx→mATX", () => {
    expect(normalizeSocketValue("lga 1700")).toBe("LGA1700");
    expect(normalizeFormFactorLoose("Micro ATX")).toBe("mATX");
    expect(normalizeFormFactorLoose("mini-itx")).toBe("ITX");
    expect(normalizeFormFactorLoose("E-ATX")).toBe("E-ATX");
    expect(normalizeFormFactorLoose("疯马")).toBeUndefined();
  });

  it("主板行：插槽归一化 + 槽数映射，类别值宽松识别", () => {
    const entry = entryFrom({
      "型号（必填）": "技嘉 B850M AORUS ELITE 小雕",
      "类别（必填）": "主板",
      "别名（检索用，分号分隔）": "小雕;b850m",
      插槽: " am5 ",
      板型: "Micro ATX",
      内存代际: "ddr5",
      内存插槽数: "4",
      "M.2槽数": "3",
      "SATA口数": "4",
      "PCIe x16槽数": "1",
    });
    expect(entry.spec).toEqual({
      socket: "AM5",
      formFactor: "mATX",
      ramType: "DDR5",
      ramSlots: 4,
      m2Slots: 3,
      sataPorts: 4,
      pcieX16Slots: 1,
    });
    expect(entry.aliases).toEqual(["小雕", "b850m"]);
    expect(entry.id.startsWith("m-")).toBe(true);
  });

  it("机箱行：多板型 + 限长限高", () => {
    const entry = entryFrom({
      "型号（必填）": "骨伽 FV160 海景房",
      "类别（必填）": "机箱",
      板型: "ATX、mATX；ITX",
      "显卡限长mm(机箱)": "330",
      "散热限高mm(机箱)": "169",
    });
    expect(entry.spec).toEqual({
      supportedFormFactors: ["ATX", "mATX", "ITX"],
      maxGpuLengthMm: 330,
      maxCoolerHeightMm: 169,
    });
  });

  it("散热器行：支持插槽列表归一化去重；水冷可无高度", () => {
    const entry = entryFrom({
      "型号（必填）": "超频三 DX360 360水冷",
      "类别（必填）": "散热器",
      "支持插槽(散热器)": "AM5; LGA 1700; am5;LGA1851",
    });
    expect(entry.spec).toEqual({ supportedSockets: ["AM5", "LGA1700", "LGA1851"] });
  });

  it("坏行报错：空型号、未知类别、负数、非法板型——一次全报", () => {
    const bad1 = rowToEntry(csvRow({ "型号（必填）": "", "类别（必填）": "主板" }));
    expect(bad1.status === "error" && bad1.errors[0]).toContain("型号为空");

    const bad2 = rowToEntry(csvRow({ "型号（必填）": "某物", "类别（必填）": "瑞士军刀" }));
    expect(bad2.status === "error" && bad2.errors[0]).toContain("类别无法识别");

    const bad3 = rowToEntry(
      csvRow({ "型号（必填）": "负数机箱", "类别（必填）": "机箱", "显卡限长mm(机箱)": "-5" }),
    );
    expect(bad3.status === "error" && bad3.errors.join()).toContain("显卡限长mm(机箱)");

    const bad4 = rowToEntry(
      csvRow({ "型号（必填）": "怪板型主板", "类别（必填）": "主板", 板型: "疯马" }),
    );
    expect(bad4.status === "error" && bad4.errors.join()).toContain("板型");
  });

  it("mergeManualEntries：同类别同名原地更新保留 id，新增排序稳定", () => {
    const existing = [
      { id: "m-old", category: "psu" as const, name: "鑫谷 无界PRO 850W", aliases: [], spec: { ratedWatts: 850 } },
    ];
    const incoming = [
      { id: "m-new1", category: "psu" as const, name: "鑫谷 无界PRO 850W", aliases: ["无界"], spec: { ratedWatts: 850, twelveVhpwr: 1 } },
      { id: "m-new2", category: "case" as const, name: "骨伽 FV160", aliases: [], spec: { supportedFormFactors: ["ATX"] } },
    ];
    const { entries, added, updated } = mergeManualEntries(existing, incoming);
    expect(added).toBe(1);
    expect(updated).toBe(1);
    const psu = entries.find((entry) => entry.category === "psu");
    expect(psu?.id).toBe("m-old");
    expect(psu?.spec).toEqual({ ratedWatts: 850, twelveVhpwr: 1 });
    // 领域类别顺序：psu(5) 在 case(7) 之前
    expect(entries.map((entry) => entry.category)).toEqual(["psu", "case"]);
  });

  describe("loadManualCatalog（运行时加载）", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rigmate-manual-load-"));

    beforeAll(() => {
      const good = join(tempDir, "manual.json");
      writeFileSync(
        good,
        JSON.stringify({
          provenance: { source: "人工整理", importedAt: "2026-09-21T00:00:00.000Z", entryCount: 1 },
          entries: [
            { id: "m-x", category: "psu", name: "鑫谷 无界PRO 850W", aliases: ["无界"], spec: { ratedWatts: 850 } },
          ],
        }),
      );
      process.env.RIGMATE_MANUAL_CATALOG_PATH = good;
    });

    afterAll(() => {
      delete process.env.RIGMATE_MANUAL_CATALOG_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("合并顺序：种子 → 人工 → BuildCores", async () => {
      const buildcoresPath = join(tempDir, "buildcores.json");
      writeFileSync(
        buildcoresPath,
        JSON.stringify({
          provenance: {
            upstreamCommit: "a".repeat(40),
            upstreamUrl: "https://github.com/buildcores/buildcores-open-db",
            license: "ODC-By 1.0",
            licenseUrl: "https://opendatacommons.org/licenses/by/1-0/",
            importedAt: "2026-09-21T00:00:00.000Z",
            entryCount: 1,
          },
          entries: [
            { id: "bc-x", category: "psu", name: "Segotep Argus 850W", aliases: [], spec: { ratedWatts: 850 } },
          ],
        }),
      );
      process.env.RIGMATE_BUILDCORES_CATALOG_PATH = buildcoresPath;
      const { mergedCatalogEntries, resetBuildcoresCatalogCacheForTests } = await import(
        "@/infra/catalog-import/load"
      );
      resetBuildcoresCatalogCacheForTests();
      const merged = mergedCatalogEntries([
        { id: "seed-x", category: "psu", name: "种子电源", aliases: [], spec: { ratedWatts: 1 } },
      ]);
      expect(merged.map((entry) => entry.id)).toEqual(["seed-x", "m-x", "bc-x"]);
    });
  });
});
