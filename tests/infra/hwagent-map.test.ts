import { describe, expect, it } from "vitest";
import { mapHwagentRecord, arrayKeyOf } from "@/infra/catalog-import/hwagent/map";

// hwagent 精选库映射回归：样例取自 data/catalog/hwagent/ 真实条目（字段形态一致）。

const CPU_RAW = {
  id: "amd-9800x3d",
  brand: "AMD",
  name_cn: "锐龙7 9800X3D",
  aliases: ["锐龙7 9800X3D", "R7 9800X3D", "AMD锐龙7 9800X3D"],
  model: "Ryzen 7 9800X3D",
  socket: "AM5",
  tdp: 120,
  ptp_max: 120,
  mem_types: ["DDR5"],
  m2_lanes: 4,
};

const GPU_RAW = {
  id: "gpu-nv-4070s",
  name_cn: "RTX 4070 SUPER",
  model: "GeForce RTX 4070 SUPER",
  length_mm: 244,
  tgp_w: 220,
  power_conn: ["8pin", "8pin"],
};

const MOBO_RAW = {
  id: "mb-msi-mag-b850m-mortar-wifi",
  name_cn: "微星 MAG B850M MORTAR WIFI 迫击炮",
  model: "MAG B850M MORTAR WIFI",
  socket: "AM5",
  ddr: ["DDR5"],
  formfactor: "Micro-ATX",
  dimm_slots: 4,
  m2_slots: 3,
  sata_ports: 4,
  pcie_slots: "1× PCIe 5.0 x16 + 1× PCIe 4.0 x4",
};

const CASE_RAW = {
  id: "case-lian-li-207",
  name_cn: "联力 LANCOOL 207",
  formfactors: ["ATX", "Micro-ATX", "Mini-ITX", "E-ATX（≤280mm 宽）"],
  gpu_max_len: 395,
  cooler_max_height: 180,
};

describe("hwagent 目录映射", () => {
  it("CPU：name_cn 作展示名，英文型号进别名，tdpWatts 取 ptp_max", () => {
    const mapped = mapHwagentRecord(CPU_RAW, "amd-9800x3d", "cpu");
    expect(mapped.id).toBe("hw-amd-9800x3d");
    expect(mapped.category).toBe("cpu");
    expect(mapped.name).toBe("锐龙7 9800X3D");
    expect(mapped.nameZh).toBe("锐龙7 9800X3D");
    expect(mapped.aliases).toContain("Ryzen 7 9800X3D");
    expect(mapped.aliases).toContain("R7 9800X3D");
    expect(mapped.spec).toEqual({ socket: "AM5", tdpWatts: 120 });
  });

  it("GPU：英文名不写 name_zh（走 localization 厂商前缀回退），供电接口计数", () => {
    const mapped = mapHwagentRecord(GPU_RAW, "gpu-nv-4070s", "gpu");
    expect(mapped.name).toBe("RTX 4070 SUPER");
    expect(mapped.nameZh).toBeNull();
    expect(mapped.spec).toEqual({ lengthMm: 244, tdpWatts: 220, pcie8pin: 2 });
  });

  it("主板：板型归一 Micro-ATX→mATX，ddr 数组取值，x16 槽数从文本计数", () => {
    const mapped = mapHwagentRecord(MOBO_RAW, "mb-msi-mag-b850m-mortar-wifi", "motherboard");
    expect(mapped.spec).toEqual({
      socket: "AM5",
      ramType: "DDR5",
      formFactor: "mATX",
      ramSlots: 4,
      m2Slots: 3,
      sataPorts: 4,
      pcieX16Slots: 1,
    });
  });

  it("机箱：E-ATX 带括号限宽说明仍归一为 E-ATX", () => {
    const mapped = mapHwagentRecord(CASE_RAW, "case-lian-li-207", "case");
    expect(mapped.spec).toEqual({
      supportedFormFactors: ["ATX", "mATX", "ITX", "E-ATX"],
      maxGpuLengthMm: 395,
      maxCoolerHeightMm: 180,
    });
  });

  it("AIO 水冷 height_mm=0（无塔高概念）：字段省略而不是写非法值", () => {
    const aio = {
      id: "cool-tr-frozen-magic-360",
      name_cn: "Thermalright Frozen Magic 360",
      sockets: ["AM5", "LGA1700", "LGA1851"],
      height_mm: 0,
    };
    const mapped = mapHwagentRecord(aio, "cool-tr-frozen-magic-360", "cooler");
    expect(mapped.spec).toEqual({ supportedSockets: ["AM5", "LGA1700", "LGA1851"] });
  });

  it("零规格条目拒绝入库（宁缺毋滥纪律）", () => {
    expect(() => mapHwagentRecord({ id: "bad-item", name_cn: "幽灵条目" }, "bad-item", "gpu")).toThrow(/没有映射出任何规格字段/);
  });

  it("文件名 → 数组键与类目", () => {
    expect(arrayKeyOf("cpu_full.json")).toEqual({ key: "cpus", hwCategory: "cpu" });
    expect(arrayKeyOf("mobo_full.json")).toEqual({ key: "mobos", hwCategory: "motherboard" });
    expect(arrayKeyOf("ram_ssd_full.json")).toEqual({ key: "ram", hwCategory: "ram" });
  });
});
