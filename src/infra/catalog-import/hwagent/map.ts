import { specSchemaByCategory, formFactorSchema, type SpecRecord } from "@/domain/build/specs";
import type { BuildItemCategory } from "@/domain/build/types";

/**
 * hw-agent 精选规格库（data/catalog/hwagent/，723 型号）→ 目录条目映射。
 *
 * 数据纪律（与全站一致）：
 * - 能映射的字段才写，映射不到留空不猜；null 一律省略键；
 * - 归一化只做等价改写（板型/接口名、供电接口计数），不做任何推断；
 * - name_cn 优先作展示名（写入 name_zh 落点），英文名进 aliases 供检索；
 * - 富余字段（tier/perf_score/vrm_score 等）二期再进 spec，本期不映射。
 */

export const HWAGENT_SOURCE_VERSION = "2026-10-14";

export const HWAGENT_FILES = [
  "cpu_full.json",
  "gpu_full.json",
  "mobo_full.json",
  "ram_ssd_full.json",
  "psu_full.json",
  "cooler_full.json",
  "case_full.json",
] as const;

export type HwagentCategory = "cpu" | "gpu" | "motherboard" | "ram" | "storage" | "psu" | "cooler" | "case";

const CATEGORY_TO_BUILD: Record<HwagentCategory, BuildItemCategory> = {
  cpu: "cpu",
  gpu: "gpu",
  motherboard: "motherboard",
  ram: "ram",
  storage: "storage",
  psu: "psu",
  cooler: "cooler",
  case: "case",
} as const;

export type MappedEntry = {
  id: string;
  category: BuildItemCategory;
  name: string;
  aliases: string[];
  nameZh: string | null;
  spec: SpecRecord;
  /** 数据集原始 id（hw- 前缀之前的部分），审计留痕用 */
  sourceId: string;
};

/** hwagent JSON 是无类型的采集产物：宽松读 + 显式归一，坏值宁可留空 */
type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
}

function str(raw: Raw, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function strList(raw: Raw, key: string): string[] {
  const value = raw[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()) : [];
}

function int(raw: Raw, key: string): number | undefined {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

/** null/undefined/空串 → undefined；数据集纪律是"未查到就 null"，绝不猜 */
function notNull<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

type FormFactorValue = (typeof formFactorSchema)["options"][number];
const FORM_FACTOR_ALIASES: Record<string, FormFactorValue> = {
  "e-atx": "E-ATX",
  atx: "ATX",
  "micro-atx": "mATX",
  "mini-itx": "ITX",
  itx: "ITX",
};

function normalizeFormFactor(value: string): string | undefined {
  const cleaned = value.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
  return FORM_FACTOR_ALIASES[cleaned.toLowerCase()];
}

function normalizeFormFactors(values: string[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeFormFactor(value);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

function parseDdr(value: string | undefined): "DDR4" | "DDR5" | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (upper.includes("DDR5")) return "DDR5";
  if (upper.includes("DDR4")) return "DDR4";
  return undefined;
}

function parsePowerConnectors(raw: Raw): { pcie8pin?: number; twelveVhpwr?: number } {
  const connectors = strList(raw, "power_conn");
  if (connectors.length === 0) return {};
  const twelveVhpwr = connectors.filter((c) => /12v2x6|12vhpwr/i.test(c)).length;
  const pcie8pin = connectors.filter((c) => /8pin/i.test(c)).length;
  return {
    ...(pcie8pin > 0 ? { pcie8pin } : {}),
    ...(twelveVhpwr > 0 ? { twelveVhpwr } : {}),
  };
}

/** "2× PCIe 5.0 x16 + 1× PCIe 4.0 x16 (x4)" → 物理 x16 槽数（电气 x4 也算槽） */
function countPcieX16Slots(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const matches = value.match(/x16/gi);
  return matches ? matches.length : undefined;
}

/** 数据集的定序权威字段：tier（1–10 档位）与 perf_score（相对性能分）全类目通用 */
function perfFields(raw: Raw): SpecRecord {
  const tier = int(raw, "tier");
  const perfScore = int(raw, "perf_score");
  return {
    ...(tier !== undefined && tier > 0 ? { tier } : {}),
    ...(perfScore !== undefined && perfScore > 0 ? { perfScore } : {}),
  };
}

function toAliases(raw: Raw, extra: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [...strList(raw, "aliases"), ...extra]) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out.slice(0, 12);
}

function baseEntry(raw: Raw, sourceId: string): { id: string; name: string; aliases: string[]; nameZh: string | null } {
  const nameZh = str(raw, "name_cn") ?? null;
  const name = nameZh ?? str(raw, "model") ?? str(raw, "name_en") ?? sourceId;
  const aliases = toAliases(raw, [str(raw, "model"), str(raw, "name_en")].filter((v): v is string => Boolean(v)));
  return {
    id: `hw-${sourceId}`,
    name: name.length <= 160 ? name : name.slice(0, 160),
    aliases,
    // name_zh 契约要求含中文；GPU 等英文名条目不写，走 localization 厂商前缀回退
    nameZh: nameZh !== null && /[\u4e00-\u9fff]/.test(nameZh) ? nameZh : null,
  };
}

// ---- 各类目 spec 映射 ----

function mapCpu(raw: Raw): SpecRecord {
  // 功耗双字段：tdpWatts=TDP 规格，ptpMaxWatts=PTP 瞬时最大（数据集明示散热/整机功耗按 PTP）
  const tdp = notNull(int(raw, "tdp"));
  const ptpMax = notNull(int(raw, "ptp_max"));
  const hasIgpu = raw.has_igpu;
  return {
    ...perfFields(raw),
    ...(str(raw, "socket") ? { socket: str(raw, "socket")! } : {}),
    ...(tdp !== undefined && tdp > 0 ? { tdpWatts: tdp } : {}),
    ...(ptpMax !== undefined && ptpMax > 0 ? { ptpMaxWatts: ptpMax } : {}),
    ...(notNull(int(raw, "m2_lanes")) !== undefined ? { m2Lanes: int(raw, "m2_lanes") } : {}),
    ...(typeof hasIgpu === "boolean" ? { hasIgpu } : {}),
  };
}

function mapMotherboard(raw: Raw): SpecRecord {
  const ddr = parseDdr(str(raw, "ddr") ?? strList(raw, "ddr")[0]);
  return {
    ...perfFields(raw),
    ...(str(raw, "socket") ? { socket: str(raw, "socket")! } : {}),
    ...(ddr ? { ramType: ddr } : {}),
    ...(normalizeFormFactor(str(raw, "formfactor") ?? "") !== undefined
      ? { formFactor: normalizeFormFactor(str(raw, "formfactor") ?? "") as FormFactorValue }
      : {}),
    ...(notNull(int(raw, "dimm_slots")) !== undefined ? { ramSlots: int(raw, "dimm_slots") } : {}),
    ...(notNull(int(raw, "m2_slots")) !== undefined ? { m2Slots: int(raw, "m2_slots") } : {}),
    ...(notNull(int(raw, "sata_ports")) !== undefined ? { sataPorts: int(raw, "sata_ports") } : {}),
    ...(countPcieX16Slots(str(raw, "pcie_slots")) !== undefined
      ? { pcieX16Slots: countPcieX16Slots(str(raw, "pcie_slots")) }
      : {}),
    ...(notNull(int(raw, "vrm_score")) !== undefined ? { vrmScore: int(raw, "vrm_score") } : {}),
    ...(notNull(int(raw, "target_cpu_tdp")) !== undefined ? { targetCpuTdpWatts: int(raw, "target_cpu_tdp") } : {}),
  };
}

function mapGpu(raw: Raw): SpecRecord {
  return {
    ...perfFields(raw),
    ...(notNull(int(raw, "length_mm")) !== undefined ? { lengthMm: int(raw, "length_mm") } : {}),
    ...(notNull(int(raw, "tgp_w")) !== undefined && int(raw, "tgp_w")! > 0 ? { tdpWatts: int(raw, "tgp_w") } : {}),
    ...parsePowerConnectors(raw),
    ...(notNull(int(raw, "vram_gb")) !== undefined ? { vramGb: int(raw, "vram_gb") } : {}),
  };
}

function mapRam(raw: Raw): SpecRecord {
  const ddr = parseDdr(str(raw, "ddr"));
  const ramHeight = notNull(int(raw, "height_mm"));
  return {
    ...perfFields(raw),
    ...(ddr ? { ddrType: ddr } : {}),
    ...(notNull(int(raw, "sticks")) !== undefined ? { sticks: int(raw, "sticks") } : {}),
    ...(ramHeight !== undefined && ramHeight > 0 ? { heightMm: ramHeight } : {}),
  };
}

function mapStorage(raw: Raw): SpecRecord {
  const iface = str(raw, "interface") ?? "";
  // 数据集 interface 形如 "M.2 2280"；nvme 版本字段非空即 NVMe 盘
  const isM2 = /^m\.2/i.test(iface) || raw.nvme !== null && raw.nvme !== undefined;
  return { ...perfFields(raw), interface: isM2 ? "m2_nvme" : "sata" };
}

function mapPsu(raw: Raw): SpecRecord {
  const twelveVhpwr = notNull(int(raw, "pcie12v2x6")) ?? 0;
  const twelveVhpwrAlt = notNull(int(raw, "pcie12vhpwr")) ?? 0;
  return {
    ...perfFields(raw),
    ...(notNull(int(raw, "watt")) !== undefined ? { ratedWatts: int(raw, "watt") } : {}),
    ...(notNull(int(raw, "pcie8")) !== undefined ? { pcie8pin: int(raw, "pcie8") } : {}),
    ...(twelveVhpwr + twelveVhpwrAlt > 0 ? { twelveVhpwr: twelveVhpwr + twelveVhpwrAlt } : {}),
  };
}

function mapCooler(raw: Raw): SpecRecord {
  const sockets = strList(raw, "sockets");
  const heightMm = int(raw, "height_mm");
  return {
    ...perfFields(raw),
    ...(sockets.length > 0 ? { supportedSockets: sockets } : {}),
    // AIO 水冷 height_mm=0（无塔高概念）：0 与"未知"在这里同义，省略而不是写非法值
    ...(heightMm !== undefined && heightMm > 0 ? { heightMm } : {}),
    ...(notNull(int(raw, "memory_clearance_mm")) !== undefined && int(raw, "memory_clearance_mm")! > 0
      ? { memoryClearanceMm: int(raw, "memory_clearance_mm") }
      : {}),
  };
}

function mapCase(raw: Raw): SpecRecord {
  const supportedFormFactors = normalizeFormFactors(strList(raw, "formfactors")) as FormFactorValue[];
  return {
    ...perfFields(raw),
    ...(supportedFormFactors.length > 0 ? { supportedFormFactors } : {}),
    ...(notNull(int(raw, "gpu_max_len")) !== undefined ? { maxGpuLengthMm: int(raw, "gpu_max_len") } : {}),
    ...(notNull(int(raw, "cooler_max_height")) !== undefined ? { maxCoolerHeightMm: int(raw, "cooler_max_height") } : {}),
  };
}

const SPEC_MAPPERS: Record<HwagentCategory, (raw: Raw) => SpecRecord> = {
  cpu: mapCpu,
  gpu: mapGpu,
  motherboard: mapMotherboard,
  ram: mapRam,
  storage: mapStorage,
  psu: mapPsu,
  cooler: mapCooler,
  case: mapCase,
};

/** 单条原始记录 → 目录条目；spec 过既有 schema 校验，坏数据抛错（与 load.ts 同一纪律） */
export function mapHwagentRecord(rawRecord: unknown, sourceId: string, hwCategory: HwagentCategory): MappedEntry {
  const raw = asRecord(rawRecord);
  const category = CATEGORY_TO_BUILD[hwCategory];
  const base = baseEntry(raw, sourceId);
  const spec = SPEC_MAPPERS[hwCategory](raw);
  if (Object.keys(spec).length === 0) {
    throw new Error(`hwagent 条目 ${sourceId} 没有映射出任何规格字段（类目 ${hwCategory}），拒绝入库`);
  }
  const parsed = specSchemaByCategory[category].parse(spec);
  return { ...base, category, spec: parsed, sourceId };
}

/** 一个数据文件的数组字段名（cpu_full.json → "cpus" 等） */
export function arrayKeyOf(fileName: string): { key: string; hwCategory: HwagentCategory } {
  switch (fileName) {
    case "cpu_full.json": return { key: "cpus", hwCategory: "cpu" };
    case "gpu_full.json": return { key: "gpus", hwCategory: "gpu" };
    case "mobo_full.json": return { key: "mobos", hwCategory: "motherboard" };
    case "ram_ssd_full.json": return { key: "ram", hwCategory: "ram" };
    case "psu_full.json": return { key: "psus", hwCategory: "psu" };
    case "cooler_full.json": return { key: "coolers", hwCategory: "cooler" };
    case "case_full.json": return { key: "cases", hwCategory: "case" };
    default: throw new Error(`未知的 hwagent 数据文件：${fileName}`);
  }
}

/** ram_ssd_full.json 里的 ssd 数组单独取（同文件双类目） */
export function ssdArrayOf(fileData: unknown): unknown[] {
  const raw = asRecord(fileData);
  return Array.isArray(raw.ssd) ? raw.ssd : [];
}
