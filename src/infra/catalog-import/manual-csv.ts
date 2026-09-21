import { randomUUID } from "node:crypto";
import { z } from "zod";
import { specSchemaByCategory } from "@/domain/build/specs";
import { buildItemCategorySchema, type BuildItemCategory } from "@/domain/build/types";
import type { CatalogEntry } from "@/domain/catalog/seed";

/**
 * 人工目录 CSV（M20 方案 A）：中文表头、值写人话（mATX / AM5 / NVMe），
 * 工具负责归一化；不确定的格子留空 = 字段缺省（绝不猜）。
 * 校验纪律与 BuildCores 导入一致：任何一行有问题 → 整包拒绝，逐行报错。
 */

export const MANUAL_CSV_HEADERS = [
  "型号（必填）",
  "类别（必填）",
  "别名（检索用，分号分隔）",
  "插槽",
  "板型",
  "内存代际",
  "内存条数",
  "内存插槽数",
  "接口(SSD)",
  "M.2槽数",
  "SATA口数",
  "PCIe x16槽数",
  "显卡长度mm",
  "TDP功率W",
  "12VHPWR口数",
  "PCIe8pin口数",
  "额定功率W",
  "支持插槽(散热器)",
  "散热高度mm",
  "显卡限长mm(机箱)",
  "散热限高mm(机箱)",
] as const;

const CATEGORY_LABELS: Record<string, BuildItemCategory> = {
  cpu: "cpu",
  主板: "motherboard",
  显卡: "gpu",
  内存: "ram",
  "ssd": "storage",
  "固态": "storage",
  硬盘: "storage",
  电源: "psu",
  散热器: "cooler",
  散热: "cooler",
  机箱: "case",
};

/** 宽松解析：去 BOM、按引号感知切分逗号（值里可以有逗号） */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

export function normalizeSocketValue(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function normalizeFormFactorLoose(value: string): string | undefined {
  const v = value.trim().toLowerCase().replace(/[\s-]/g, "");
  if (v === "atx") return "ATX";
  if (v === "matx" || v === "microatx") return "mATX";
  if (v === "itx" || v === "miniitx") return "ITX";
  if (v === "eatx" || v === "eeatx" || v === "eatx") return "E-ATX";
  return undefined;
}

function splitList(value: string): string[] {
  return value
    .split(/[;；,，、/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function intField(raw: string | undefined, label: string, errors: string[], opts?: { positive?: boolean }): number | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || (opts?.positive ? parsed <= 0 : parsed < 0)) {
    errors.push(`${label}需要${opts?.positive ? "正整数" : "非负整数"}（填了"${text}"）`);
    return undefined;
  }
  return parsed;
}

export type ManualRowResult =
  | { status: "ok"; entry: CatalogEntry }
  | { status: "error"; errors: string[] };

export function rowToEntry(row: (string | undefined)[]): ManualRowResult {
  const errors: string[] = [];
  const col = (header: (typeof MANUAL_CSV_HEADERS)[number]): string | undefined => {
    const index = MANUAL_CSV_HEADERS.indexOf(header);
    return row[index]?.trim() || undefined;
  };

  const name = col("型号（必填）");
  if (!name) return { status: "error", errors: ["型号为空"] };
  if (name.length > 160) errors.push("型号超过 160 字");

  const categoryLabel = col("类别（必填）")?.toLowerCase();
  const category = categoryLabel ? CATEGORY_LABELS[categoryLabel] : undefined;
  if (!category) {
    errors.push(`类别无法识别（填了"${col("类别（必填）")}"，可用：CPU/主板/显卡/内存/SSD/电源/散热器/机箱）`);
    return { status: "error", errors };
  }

  const aliases = splitList(col("别名（检索用，分号分隔）") ?? "");

  const spec: Record<string, unknown> = {};
  const socket = col("插槽");
  if (socket) spec.socket = normalizeSocketValue(socket);
  const ddr = col("内存代际")?.toUpperCase();
  if (ddr) {
    if (ddr === "DDR4" || ddr === "DDR5") {
      // 同一列按类别落到不同字段：主板是支持的内存代际，内存是自身代际
      if (category === "motherboard") spec.ramType = ddr;
      else if (category === "ram") spec.ddrType = ddr;
    } else {
      errors.push(`内存代际只支持 DDR4/DDR5（填了"${col("内存代际")}"）`);
    }
  }
  const sticks = intField(col("内存条数"), "内存条数", errors, { positive: true });
  if (sticks !== undefined) spec.sticks = sticks;
  const ifaceRaw = col("接口(SSD)")?.toLowerCase();
  if (ifaceRaw) {
    if (ifaceRaw.includes("nvme") || ifaceRaw === "m.2" || ifaceRaw === "m2") spec.interface = "m2_nvme";
    else if (ifaceRaw.includes("sata")) spec.interface = "sata";
    else errors.push(`SSD 接口只支持 NVMe/M.2/SATA（填了"${col("接口(SSD)")}"）`);
  }

  const m2Slots = intField(row[MANUAL_CSV_HEADERS.indexOf("M.2槽数")], "M.2槽数", errors);
  if (m2Slots !== undefined) spec.m2Slots = m2Slots;
  const ramSlots = intField(row[MANUAL_CSV_HEADERS.indexOf("内存插槽数")], "内存插槽数", errors, { positive: true });
  if (ramSlots !== undefined) spec.ramSlots = ramSlots;
  const sata = intField(row[MANUAL_CSV_HEADERS.indexOf("SATA口数")], "SATA口数", errors);
  if (sata !== undefined) spec.sataPorts = sata;
  const x16 = intField(row[MANUAL_CSV_HEADERS.indexOf("PCIe x16槽数")], "PCIe x16槽数", errors);
  if (x16 !== undefined) spec.pcieX16Slots = x16;

  const tdp = intField(row[MANUAL_CSV_HEADERS.indexOf("TDP功率W")], "TDP功率W", errors, { positive: true });
  if (tdp !== undefined) spec.tdpWatts = tdp;
  const length = intField(row[MANUAL_CSV_HEADERS.indexOf("显卡长度mm")], "显卡长度mm", errors, { positive: true });
  if (length !== undefined) spec.lengthMm = length;
  const vhpwr = intField(row[MANUAL_CSV_HEADERS.indexOf("12VHPWR口数")], "12VHPWR口数", errors);
  if (vhpwr !== undefined) spec.twelveVhpwr = vhpwr;
  const pcie8 = intField(row[MANUAL_CSV_HEADERS.indexOf("PCIe8pin口数")], "PCIe8pin口数", errors);
  if (pcie8 !== undefined) spec.pcie8pin = pcie8;
  const watt = intField(row[MANUAL_CSV_HEADERS.indexOf("额定功率W")], "额定功率W", errors, { positive: true });
  if (watt !== undefined) spec.ratedWatts = watt;
  const height = intField(row[MANUAL_CSV_HEADERS.indexOf("散热高度mm")], "散热高度mm", errors, { positive: true });
  if (height !== undefined) spec.heightMm = height;
  const maxGpu = intField(row[MANUAL_CSV_HEADERS.indexOf("显卡限长mm(机箱)")], "显卡限长mm(机箱)", errors, { positive: true });
  if (maxGpu !== undefined) spec.maxGpuLengthMm = maxGpu;
  const maxCooler = intField(row[MANUAL_CSV_HEADERS.indexOf("散热限高mm(机箱)")], "散热限高mm(机箱)", errors, { positive: true });
  if (maxCooler !== undefined) spec.maxCoolerHeightMm = maxCooler;

  const formFactors = splitList(col("板型") ?? "")
    .map(normalizeFormFactorLoose)
    .filter((value): value is string => value !== undefined);
  const formFactorRaw = col("板型");
  if (formFactorRaw && formFactors.length !== splitList(formFactorRaw).length) {
    errors.push(`板型有无法识别的值（填了"${formFactorRaw}"，可用：ATX/mATX/ITX/E-ATX）`);
  }
  if (formFactors.length > 0) {
    if (category === "motherboard") {
      if (formFactors.length > 1) errors.push("主板的板型只能填一个");
      else spec.formFactor = formFactors[0];
    } else {
      spec.supportedFormFactors = formFactors;
    }
  }

  const supportedSockets = splitList(col("支持插槽(散热器)") ?? "").map(normalizeSocketValue);
  if (supportedSockets.length > 0) spec.supportedSockets = [...new Set(supportedSockets)];

  if (errors.length > 0) return { status: "error", errors };

  // 只保留该类别 schema 认识的字段（如 CPU 行误填限长会被静默剔除——列本身就不该填）
  const parsed = specSchemaByCategory[category].parse(spec);
  if (Object.keys(parsed).length === 0) {
    // 允许全空规格（用户只录名字），但提示价值有限——不算错误
  }
  return { status: "ok", entry: { id: `m-${randomUUID()}`, category, name, aliases, spec: parsed } };
}

/** 把新行合并进已有名单：同类别同名 → 原地更新（保留 id），否则新增 */
export function mergeManualEntries(
  existing: CatalogEntry[],
  incoming: CatalogEntry[],
): { entries: CatalogEntry[]; added: number; updated: number } {
  const byKey = new Map(existing.map((entry) => [`${entry.category}::${entry.name}`, entry]));
  let updated = 0;
  for (const entry of incoming) {
    const key = `${entry.category}::${entry.name}`;
    const previous = byKey.get(key);
    if (previous) {
      byKey.set(key, { ...entry, id: previous.id });
      updated += 1;
    } else {
      byKey.set(key, entry);
    }
  }
  const entries = [...byKey.values()].sort(
    (a, b) =>
      buildItemCategorySchema.options.indexOf(a.category) -
        buildItemCategorySchema.options.indexOf(b.category) || (a.name < b.name ? -1 : 1),
  );
  return { entries, added: incoming.length - updated, updated };
}

export const manualCatalogFileSchema = z.object({
  provenance: z.object({
    source: z.string().min(1),
    importedAt: z.string().min(1),
    entryCount: z.number().int().nonnegative(),
    note: z.string().optional(),
  }),
  entries: z.array(
    z.object({
      id: z.string().min(1),
      category: buildItemCategorySchema,
      name: z.string().min(1),
      aliases: z.array(z.string()),
      spec: z.record(z.string(), z.unknown()),
    }),
  ),
});
