import { specSchemaByCategory } from "@/domain/build/specs";
import type { BuildItemCategory } from "@/domain/build/types";
import type { CatalogEntry } from "@/domain/catalog/seed";
import {
  caseSourceSchema,
  coolerSourceSchema,
  cpuSourceSchema,
  gpuSourceSchema,
  motherboardSourceSchema,
  psuSourceSchema,
  ramSourceSchema,
  storageSourceSchema,
} from "./source-schemas";

/**
 * BuildCores 记录 → 本目录条目的字段映射（ADR §8.1-2/3/4：类别与字段映射、
 * 中国大陆 SKU 适配留给人工目录，缺字段**故意缺省**——带不出来的规格一律不写，
 * 绝不猜默认值。数值取整只做四舍五入，不做单位换算（上游毫米/瓦与本目录一致）。
 */

export type MappedOutcome =
  | { status: "ok"; entry: CatalogEntry }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

/** BuildCores 枚举用 "LGA 1700"（带空格），本目录与规则约定 "LGA1700"；统一大写 */
export function normalizeSocket(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase();
}

/** 上游板型 → 本目录四档；其余板型（DTX/SSI 等）不带出（规格 schema 外的值不猜） */
export function mapFormFactor(value: string): "E-ATX" | "ATX" | "mATX" | "ITX" | undefined {
  switch (value.trim()) {
    case "ATX":
      return "ATX";
    case "Micro ATX":
      return "mATX";
    case "Mini-ITX":
      return "ITX";
    case "EATX":
      return "E-ATX";
    default:
      return undefined;
  }
}

/** 上游 Storage.interface → 本目录 interface；识别不了的（U.2/mSATA 等）不带出 */
export function mapStorageInterface(value: string): "m2_nvme" | "sata" | undefined {
  const v = value.trim();
  if (v.startsWith("M.2 PCIe")) return "m2_nvme";
  if (v === "M.2 SATA" || v.startsWith("SATA")) return "sata";
  return undefined;
}

function positiveInt(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

function nonNegativeInt(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

function requireName(metadata: { name?: string | null }, opendbId: string): string {
  const name = metadata.name?.trim() ?? "";
  if (!name) {
    throw new Error(`记录 ${opendbId} 缺 metadata.name，无法作为目录条目`);
  }
  return name;
}

function finalize(
  opendbId: string,
  category: BuildItemCategory,
  name: string,
  spec: Record<string, unknown>,
): MappedOutcome {
  const meaningful = Object.entries(spec).filter(([, value]) => value !== undefined);
  if (meaningful.length === 0) {
    return { status: "skipped", reason: "没有可映射到本目录的规格字段" };
  }
  // 映射完立即按类别 schema 校验：坏数据在这一步就报错，不进目录
  const parsed = specSchemaByCategory[category].parse(Object.fromEntries(meaningful));
  return {
    status: "ok",
    entry: { id: `bc-${opendbId}`, category, name, aliases: [], spec: parsed },
  };
}

export function mapCpuRecord(record: unknown): MappedOutcome {
  const parsed = cpuSourceSchema.parse(record);
  let name: string;
  try {
    name = requireName(parsed.metadata, parsed.opendb_id);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
  const spec: Record<string, unknown> = {};
  const socket = parsed.socket?.trim();
  if (socket) spec.socket = normalizeSocket(socket);
  // AMD 记录 tdp 与 ppt 并存时取 tdp；tdp 缺失/为 0 时 ppt 是真实供电上限
  const tdp = positiveInt(parsed.specifications?.tdp) ?? positiveInt(parsed.specifications?.ppt);
  if (tdp !== undefined) spec.tdpWatts = tdp;
  return finalize(parsed.opendb_id, "cpu", name, spec);
}

export function mapMotherboardRecord(record: unknown): MappedOutcome {
  const parsed = motherboardSourceSchema.parse(record);
  let name: string;
  try {
    name = requireName(parsed.metadata, parsed.opendb_id);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
  const spec: Record<string, unknown> = {};
  const socket = parsed.socket?.trim();
  if (socket) spec.socket = normalizeSocket(socket);
  const formFactor = parsed.form_factor ? mapFormFactor(parsed.form_factor) : undefined;
  if (formFactor) spec.formFactor = formFactor;
  const ramType = parsed.memory?.ram_type?.trim().toUpperCase();
  if (ramType === "DDR4" || ramType === "DDR5") spec.ramType = ramType;
  const ramSlots = positiveInt(parsed.memory?.slots);
  if (ramSlots !== undefined) spec.ramSlots = ramSlots;
  // 上游 m2_slots 数组按"支持的尺寸"展开（一个槽可占两行），条数 ≠ 物理槽数——
  // 推不出可靠值就不带出（缺着比错着好）
  const storage = parsed.storage_devices;
  if (storage) {
    const sata6 = storage.sata_6_gb_s ?? 0;
    const sata3 = storage.sata_3_gb_s ?? 0;
    const sataSum = sata6 + sata3;
    // 全零大概率是上游占位（多数 ATX 板有 SATA），不为它断言"没有 SATA"
    if (sataSum > 0) spec.sataPorts = Math.round(sataSum);
  }
  const pcieSlots = parsed.pcie_slots;
  if (pcieSlots) {
    // 本目录 pcieX16Slots 语义 = 物理开放 x16 槽位（给独显用）：只统计 lanes=16 的槽
    const x16 = pcieSlots
      .filter((slot) => slot.lanes === 16)
      .reduce((sum, slot) => sum + (slot.quantity ?? 0), 0);
    const total = nonNegativeInt(x16);
    if (total !== undefined) spec.pcieX16Slots = total;
  }
  return finalize(parsed.opendb_id, "motherboard", name, spec);
}

export function mapGpuRecord(record: unknown): MappedOutcome {
  const parsed = gpuSourceSchema.parse(record);
  let name: string;
  try {
    name = requireName(parsed.metadata, parsed.opendb_id);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
  const spec: Record<string, unknown> = {};
  const tdp = positiveInt(parsed.tdp);
  if (tdp !== undefined) spec.tdpWatts = tdp;
  const length = positiveInt(parsed.length);
  if (length !== undefined) spec.lengthMm = length;
  if (parsed.power_connectors) {
    spec.pcie8pin = nonNegativeInt(parsed.power_connectors.pcie_8_pin ?? 0);
    // 12VHPWR 与其修订版 12V-2x6 是同族 16pin 供电，合并计数
    spec.twelveVhpwr = nonNegativeInt(
      (parsed.power_connectors.pcie_12VHPWR ?? 0) + (parsed.power_connectors.pcie_12V_2x6 ?? 0),
    );
  }
  return finalize(parsed.opendb_id, "gpu", name, spec);
}

export function mapRamRecord(record: unknown): MappedOutcome {
  const parsed = ramSourceSchema.parse(record);
  let name: string;
  try {
    name = requireName(parsed.metadata, parsed.opendb_id);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
  const spec: Record<string, unknown> = {};
  const ddrType = parsed.ram_type?.trim().toUpperCase();
  if (ddrType === "DDR4" || ddrType === "DDR5") spec.ddrType = ddrType;
  const sticks = positiveInt(parsed.modules?.quantity);
  if (sticks !== undefined) spec.sticks = sticks;
  return finalize(parsed.opendb_id, "ram", name, spec);
}

export function mapStorageRecord(record: unknown): MappedOutcome {
  const parsed = storageSourceSchema.parse(record);
  let name: string;
  try {
    name = requireName(parsed.metadata, parsed.opendb_id);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
  const spec: Record<string, unknown> = {};
  const iface = parsed.interface ? mapStorageInterface(parsed.interface) : undefined;
  if (iface) spec.interface = iface;
  return finalize(parsed.opendb_id, "storage", name, spec);
}

export function mapPsuRecord(record: unknown): MappedOutcome {
  const parsed = psuSourceSchema.parse(record);
  let name: string;
  try {
    name = requireName(parsed.metadata, parsed.opendb_id);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
  const spec: Record<string, unknown> = {};
  const wattage = positiveInt(parsed.wattage);
  if (wattage !== undefined) spec.ratedWatts = wattage;
  if (parsed.connectors) {
    // 上游没有单独的 8pin 字段，6+2 pin 即可当 8pin 用（业界口径）
    spec.pcie8pin = nonNegativeInt(parsed.connectors.pcie_6_plus_2_pin ?? 0);
    spec.twelveVhpwr = nonNegativeInt(parsed.connectors.pcie_12vhpwr ?? 0);
  }
  return finalize(parsed.opendb_id, "psu", name, spec);
}

export function mapCoolerRecord(record: unknown): MappedOutcome {
  const parsed = coolerSourceSchema.parse(record);
  let name: string;
  try {
    name = requireName(parsed.metadata, parsed.opendb_id);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
  const spec: Record<string, unknown> = {};
  if (parsed.cpu_sockets) {
    const sockets = [...new Set(parsed.cpu_sockets.map(normalizeSocket).filter(Boolean))];
    if (sockets.length > 0) spec.supportedSockets = sockets;
  }
  // 高度限高规则针对风冷；水冷的 height 是泵头尺寸，与机箱限高语义不同，不带出
  if (parsed.water_cooled !== true) {
    const height = positiveInt(parsed.height);
    if (height !== undefined) spec.heightMm = height;
  }
  return finalize(parsed.opendb_id, "cooler", name, spec);
}

export function mapCaseRecord(record: unknown): MappedOutcome {
  const parsed = caseSourceSchema.parse(record);
  let name: string;
  try {
    name = requireName(parsed.metadata, parsed.opendb_id);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
  const spec: Record<string, unknown> = {};
  if (parsed.supported_motherboard_form_factors) {
    const formFactors = [
      ...new Set(
        parsed.supported_motherboard_form_factors
          .map(mapFormFactor)
          .filter((value): value is "E-ATX" | "ATX" | "mATX" | "ITX" => value !== undefined),
      ),
    ];
    if (formFactors.length > 0) spec.supportedFormFactors = formFactors;
  }
  const maxGpu = positiveInt(parsed.max_video_card_length);
  if (maxGpu !== undefined) spec.maxGpuLengthMm = maxGpu;
  const maxCooler = positiveInt(parsed.max_cpu_cooler_height);
  if (maxCooler !== undefined) spec.maxCoolerHeightMm = maxCooler;
  return finalize(parsed.opendb_id, "case", name, spec);
}

const mappersByCategory = {
  cpu: mapCpuRecord,
  motherboard: mapMotherboardRecord,
  gpu: mapGpuRecord,
  ram: mapRamRecord,
  storage: mapStorageRecord,
  psu: mapPsuRecord,
  cooler: mapCoolerRecord,
  case: mapCaseRecord,
} as const satisfies Record<BuildItemCategory, (record: unknown) => MappedOutcome>;

export function mapSourceRecord(category: BuildItemCategory, record: unknown): MappedOutcome {
  try {
    return mappersByCategory[category](record);
  } catch (error) {
    return { status: "error", reason: `源记录校验失败：${(error as Error).message}` };
  }
}
