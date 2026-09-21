import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBuildcoresCatalogCacheForTests } from "@/infra/catalog-import/load";
import {
  mapCaseRecord,
  mapCpuRecord,
  mapCoolerRecord,
  mapGpuRecord,
  mapMotherboardRecord,
  mapPsuRecord,
  mapRamRecord,
  mapSourceRecord,
  mapStorageRecord,
  normalizeSocket,
} from "@/infra/catalog-import/map";
import { runImport } from "@/infra/catalog-import/run";

/* ---------- 映射：字段名逐字对齐上游 schema（schemas/*.schema.json） ---------- */

describe("BuildCores → 目录字段映射", () => {
  it("normalizeSocket 剥空格并大写（上游 LGA 1700 → 本目录 LGA1700）", () => {
    expect(normalizeSocket("LGA 1700")).toBe("LGA1700");
    expect(normalizeSocket("AM5")).toBe("AM5");
    expect(normalizeSocket(" am4 ")).toBe("AM4");
  });

  it("CPU：socket 归一化 + tdp 优先、ppt 兜底", () => {
    const outcome = mapCpuRecord({
      opendb_id: "uuid-1",
      socket: "LGA 1700",
      specifications: { tdp: 125, ppt: 241 },
      metadata: { name: "Intel Core i5-14600KF" },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.entry.spec).toEqual({ socket: "LGA1700", tdpWatts: 125 });
    expect(outcome.entry.id).toBe("bc-uuid-1");
  });

  it("CPU：tdp 为 0 时用 ppt（AMD 上游常见），两者都缺则不带该字段", () => {
    const viaPpt = mapCpuRecord({
      opendb_id: "uuid-2",
      socket: "AM5",
      specifications: { tdp: 0, ppt: 162 },
      metadata: { name: "AMD Ryzen 9 7950X" },
    });
    expect(viaPpt.status).toBe("ok");
    if (viaPpt.status === "ok") expect(viaPpt.entry.spec).toEqual({ socket: "AM5", tdpWatts: 162 });

    const none = mapCpuRecord({
      opendb_id: "uuid-3",
      socket: "AM5",
      specifications: { tdp: null, ppt: null },
      metadata: { name: "AMD Ryzen 缺功耗" },
    });
    expect(none.status).toBe("ok");
    if (none.status === "ok") expect(none.entry.spec).toEqual({ socket: "AM5" });
  });

  it("主板：板型/内存/槽位映射，未知板型不带出", () => {
    const outcome = mapMotherboardRecord({
      opendb_id: "uuid-mb",
      socket: "LGA 1700",
      form_factor: "Micro ATX",
      memory: { ram_type: "DDR5", slots: 4 },
      pcie_slots: [
        { quantity: 1, lanes: 16 },
        { quantity: 2, lanes: 1 },
      ],
      m2_slots: [{}, {}],
      storage_devices: { sata_6_gb_s: 4, sata_3_gb_s: 0 },
      metadata: { name: "微星 PRO B760M-A WIFI" },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    // m2Slots 不从上游数组带出（该数组按支持尺寸展开，非物理槽数）
    expect(outcome.entry.spec).toEqual({
      socket: "LGA1700",
      formFactor: "mATX",
      ramType: "DDR5",
      ramSlots: 4,
      sataPorts: 4,
      pcieX16Slots: 1,
    });
  });

  it("主板：上游 SATA 全零视为未填写，不断言'没有 SATA'", () => {
    const outcome = mapMotherboardRecord({
      opendb_id: "uuid-mb-zero",
      socket: "LGA 1700",
      storage_devices: { sata_6_gb_s: 0, sata_3_gb_s: 0 },
      metadata: { name: "某 Z790 主板" },
    });
    expect(outcome.status === "ok" && outcome.entry.spec.sataPorts).toBe(undefined);
  });

  it("显卡：长度/TDP/供电接口直映，12V-2x6 并入 16pin 计数", () => {
    const outcome = mapGpuRecord({
      opendb_id: "uuid-gpu",
      tdp: 450,
      length: 336,
      power_connectors: { pcie_8_pin: 0, pcie_12VHPWR: 1, pcie_12V_2x6: 1 },
      metadata: { name: "NVIDIA RTX 4090 某品牌非公" },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.entry.spec).toEqual({ tdpWatts: 450, lengthMm: 336, pcie8pin: 0, twelveVhpwr: 2 });
  });

  it("内存：ddrType + 条数", () => {
    const outcome = mapRamRecord({
      opendb_id: "uuid-ram",
      ram_type: "DDR5",
      modules: { quantity: 2 },
      metadata: { name: "芝奇幻锋戟 32GB" },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.entry.spec).toEqual({ ddrType: "DDR5", sticks: 2 });
  });

  it("存储：M.2 PCIe → m2_nvme，M.2 SATA / SATA → sata，识别不了不带出", () => {
    const nvme = mapStorageRecord({
      opendb_id: "uuid-ssd",
      interface: "M.2 PCIe 3.0 x4",
      metadata: { name: "某 NVMe 盘" },
    });
    expect(nvme.status === "ok" && nvme.entry.spec).toEqual({ interface: "m2_nvme" });

    const sata = mapStorageRecord({
      opendb_id: "uuid-ssd2",
      interface: "M.2 SATA",
      metadata: { name: "某 M.2 SATA 盘" },
    });
    expect(sata.status === "ok" && sata.entry.spec).toEqual({ interface: "sata" });

    const unknown = mapStorageRecord({
      opendb_id: "uuid-ssd3",
      interface: "U.2",
      metadata: { name: "某 U.2 盘" },
    });
    expect(unknown.status).toBe("skipped");
  });

  it("电源：wattage + 6+2 pin 计 8pin + 12vhpwr（小写键）", () => {
    const outcome = mapPsuRecord({
      opendb_id: "uuid-psu",
      wattage: 850,
      connectors: { pcie_6_plus_2_pin: 4, pcie_12vhpwr: 1 },
      metadata: { name: "华硕 TUF 850W" },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.entry.spec).toEqual({ ratedWatts: 850, pcie8pin: 4, twelveVhpwr: 1 });
    }
  });

  it("散热器：插槽归一化去重；水冷不带高度（限高规则语义针对风冷）", () => {
    const air = mapCoolerRecord({
      opendb_id: "uuid-cool",
      height: 155,
      water_cooled: false,
      cpu_sockets: ["AM5", "LGA 1700", "AM5"],
      metadata: { name: "利民 PA120 SE" },
    });
    expect(air.status === "ok" && air.entry.spec).toEqual({
      supportedSockets: ["AM5", "LGA1700"],
      heightMm: 155,
    });

    const water = mapCoolerRecord({
      opendb_id: "uuid-cool2",
      height: 56,
      water_cooled: true,
      cpu_sockets: ["AM5"],
      metadata: { name: "某 240 水冷" },
    });
    expect(water.status === "ok" && water.entry.spec).toEqual({ supportedSockets: ["AM5"] });
  });

  it("机箱：支持板型过滤映射 + 显卡限长 + 限高", () => {
    const outcome = mapCaseRecord({
      opendb_id: "uuid-case",
      supported_motherboard_form_factors: ["ATX", "Micro ATX", "Mini-ITX", "DTX"],
      max_video_card_length: 330,
      max_cpu_cooler_height: 169,
      metadata: { name: "先马 平头哥 M2" },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.entry.spec).toEqual({
      supportedFormFactors: ["ATX", "mATX", "ITX"],
      maxGpuLengthMm: 330,
      maxCoolerHeightMm: 169,
    });
  });

  it("缺 metadata.name → error；无任何可映射字段 → skipped；schema 违例 → error", () => {
    const noName = mapCpuRecord({
      opendb_id: "uuid-bad",
      socket: "AM5",
      metadata: { name: null },
    });
    expect(noName.status).toBe("error");

    const noSpec = mapCpuRecord({
      opendb_id: "uuid-empty",
      metadata: { name: "只有名字的 CPU" },
    });
    expect(noSpec.status).toBe("skipped");

    const badSpec = mapSourceRecord("ram", {
      opendb_id: "uuid-badspec",
      ram_type: "DDR5",
      modules: { quantity: "两条" },
      metadata: { name: "条数不是数字" },
    });
    expect(badSpec.status).toBe("error");

    expect(
      mapSourceRecord("gpu", { opendb_id: "x", metadata: { name: "x" }, tdp: "很猛" }).status,
    ).toBe("error");
  });
});

/* ---------- 加载器 + 完整导入管线 ---------- */

describe("BuildCores 导入管线与运行时加载", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "rigmate-catalog-import-"));
  const sourceRoot = join(tempDir, "opendb");
  const outputPath = join(tempDir, "out", "buildcores.json");

  beforeAll(() => {
    process.env.RIGMATE_DB_PATH = join(tempDir, "import-runs.db");
    // 伪上游：CPU 目录一个合法记录、一个坏 JSON、一个文件名不一致、一个缺 name
    mkdirSync(join(sourceRoot, "open-db", "CPU"), { recursive: true });
    mkdirSync(join(sourceRoot, "open-db", "GPU"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "open-db", "CPU", "11111111-1111-4111-8111-111111111111.json"),
      JSON.stringify({
        opendb_id: "11111111-1111-4111-8111-111111111111",
        socket: "AM5",
        specifications: { tdp: 120 },
        metadata: { name: "AMD Ryzen 7 9800X3D" },
      }),
    );
    writeFileSync(
      join(sourceRoot, "open-db", "CPU", "broken.json"),
      "{not json",
    );
    writeFileSync(
      join(sourceRoot, "open-db", "CPU", "22222222-2222-4222-8222-222222222222.json"),
      JSON.stringify({
        opendb_id: "33333333-3333-4333-8333-333333333333",
        metadata: { name: "id 不一致" },
      }),
    );
    writeFileSync(
      join(sourceRoot, "open-db", "GPU", "44444444-4444-4444-8444-444444444444.json"),
      JSON.stringify({
        opendb_id: "44444444-4444-4444-8444-444444444444",
        tdp: 220,
        length: 267,
        power_connectors: { pcie_8_pin: 0, pcie_12VHPWR: 1, pcie_12V_2x6: 0 },
        metadata: { name: "NVIDIA RTX 4070 SUPER 某非公" },
      }),
    );
  });

  afterAll(async () => {
    delete process.env.RIGMATE_DB_PATH;
    resetBuildcoresCatalogCacheForTests();
    // runImport 落审计记录时经 ensureDatabase 打开了 SQLite 连接，先关再删目录（Windows 文件锁）
    const { closeDatabase } = await import("@/infra/db/client");
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("runImport：统计/错误记录/JSON 产物/审计落库 全链路", () => {
    const summary = runImport({
      sourceRoot,
      upstreamCommit: "4bbac3cd57a57cef3b017b24c2b664361cb886c8",
      outputPath,
    });

    expect(summary.filesRead).toBe(4);
    expect(summary.importedCount).toBe(2);
    expect(summary.errorCount).toBe(2);
    expect(summary.recordedErrors.length).toBeGreaterThan(0);

    const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
      provenance: { upstreamCommit: string; entryCount: number; license: string };
      entries: { id: string; name: string; spec: Record<string, unknown> }[];
    };
    expect(payload.provenance.entryCount).toBe(2);
    expect(payload.provenance.upstreamCommit).toBe("4bbac3cd57a57cef3b017b24c2b664361cb886c8");
    expect(payload.provenance.license).toBe("ODC-By 1.0");
    expect(payload.entries.map((e) => e.name)).toEqual([
      "AMD Ryzen 7 9800X3D",
      "NVIDIA RTX 4070 SUPER 某非公",
    ]);
  });

  it("runImport：全空数据源时拒绝写入目录文件", () => {
    const emptyRoot = join(tempDir, "empty-opendb");
    for (const dir of ["CPU", "Motherboard", "GPU", "RAM", "Storage", "PSU", "CPUCooler", "PCCase"]) {
      mkdirSync(join(emptyRoot, "open-db", dir), { recursive: true });
    }
    expect(() =>
      runImport({
        sourceRoot: emptyRoot,
        upstreamCommit: "0".repeat(40),
        outputPath: join(tempDir, "out", "empty.json"),
      }),
    ).toThrow(/导入结果为空/);
  });
});

describe("loadBuildcoresCatalog（运行时加载）", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "rigmate-catalog-load-"));

  beforeEach(() => {
    resetBuildcoresCatalogCacheForTests();
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("文件不存在 → null（目录退回人工种子）", async () => {
    process.env.RIGMATE_BUILDCORES_CATALOG_PATH = join(tempDir, "missing.json");
    const { loadBuildcoresCatalog } = await import("@/infra/catalog-import/load");
    expect(loadBuildcoresCatalog()).toBeNull();
  });

  it("合法产物加载并校验；坏条目抛错（坏数据不上线）", async () => {
    const goodPath = join(tempDir, "good.json");
    writeFileSync(
      goodPath,
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
          {
            id: "bc-uuid",
            category: "cpu",
            name: "AMD Ryzen 7 9800X3D",
            aliases: [],
            spec: { socket: "AM5", tdpWatts: 120 },
          },
        ],
      }),
    );
    process.env.RIGMATE_BUILDCORES_CATALOG_PATH = goodPath;
    const { loadBuildcoresCatalog } = await import("@/infra/catalog-import/load");
    const loaded = loadBuildcoresCatalog();
    expect(loaded?.entries[0]?.spec).toEqual({ socket: "AM5", tdpWatts: 120 });

    const badPath = join(tempDir, "bad.json");
    writeFileSync(
      badPath,
      JSON.stringify({
        provenance: {
          upstreamCommit: "a".repeat(40),
          upstreamUrl: "x",
          license: "ODC-By 1.0",
          licenseUrl: "x",
          importedAt: "2026-09-21T00:00:00.000Z",
          entryCount: 1,
        },
        entries: [
          { id: "bc-uuid2", category: "cpu", name: "坏规格", aliases: [], spec: { tdpWatts: -5 } },
        ],
      }),
    );
    process.env.RIGMATE_BUILDCORES_CATALOG_PATH = badPath;
    resetBuildcoresCatalogCacheForTests();
    expect(() => loadBuildcoresCatalog()).toThrow();

    vi.restoreAllMocks();
  });
});
