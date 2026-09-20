import type { BuildItemCategory } from "@/domain/build/types";

export type FieldDef =
  | { key: string; label: string; type: "text"; placeholder: string }
  | { key: string; label: string; type: "number"; placeholder: string }
  | {
      key: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
    };

export type ItemSpec = Record<string, string | number | string[] | undefined>;

type CategoryMeta = {
  label: string;
  badge: string;
  fields: FieldDef[];
  summary: (spec: ItemSpec) => string;
};

export type { CategoryMeta };

function joinParts(parts: (string | undefined)[]): string {
  const defined = parts.filter((part): part is string => Boolean(part));
  return defined.length > 0 ? defined.join(" · ") : "规格待补充";
}

const RAM_TYPE_OPTIONS = [
  { value: "DDR5", label: "DDR5" },
  { value: "DDR4", label: "DDR4" },
];

const FORM_FACTOR_OPTIONS = [
  { value: "mATX", label: "mATX" },
  { value: "ATX", label: "ATX" },
  { value: "ITX", label: "ITX" },
  { value: "E-ATX", label: "E-ATX" },
];

const STORAGE_INTERFACE_OPTIONS = [
  { value: "m2_nvme", label: "M.2 NVMe" },
  { value: "sata", label: "SATA" },
];

export const CATEGORY_META: Record<BuildItemCategory, CategoryMeta> = {
  cpu: {
    label: "CPU",
    badge: "CPU",
    fields: [
      { key: "socket", label: "插槽 用于第一项规则", type: "text", placeholder: "例如：AM5" },
      { key: "tdpWatts", label: "TDP 功耗（W）", type: "number", placeholder: "例如：120" },
    ],
    summary: (spec) =>
      joinParts([
        typeof spec.socket === "string" ? `${spec.socket} 插槽` : undefined,
        typeof spec.tdpWatts === "number" ? `${spec.tdpWatts}W` : undefined,
      ]),
  },
  motherboard: {
    label: "主板",
    badge: "MB",
    fields: [
      { key: "socket", label: "插槽 用于第一项规则", type: "text", placeholder: "例如：AM5" },
      { key: "ramType", label: "内存代际", type: "select", options: RAM_TYPE_OPTIONS },
      { key: "formFactor", label: "板型", type: "select", options: FORM_FACTOR_OPTIONS },
      { key: "ramSlots", label: "内存插槽数", type: "number", placeholder: "例如：4" },
      { key: "m2Slots", label: "M.2 插槽数", type: "number", placeholder: "例如：2" },
      { key: "sataPorts", label: "SATA 接口数", type: "number", placeholder: "例如：4" },
      { key: "pcieX16Slots", label: "PCIe x16 插槽数", type: "number", placeholder: "例如：1" },
    ],
    summary: (spec) =>
      joinParts([
        typeof spec.socket === "string" ? `${spec.socket} 插槽` : undefined,
        typeof spec.formFactor === "string" ? spec.formFactor : undefined,
        typeof spec.ramType === "string" ? spec.ramType : undefined,
      ]),
  },
  gpu: {
    label: "显卡",
    badge: "GPU",
    fields: [
      { key: "lengthMm", label: "长度（mm）", type: "number", placeholder: "例如：320" },
      { key: "tdpWatts", label: "TDP 功耗（W）", type: "number", placeholder: "例如：220" },
      { key: "pcie8pin", label: "PCIe 8pin 接口数", type: "number", placeholder: "例如：1" },
      { key: "twelveVhpwr", label: "12VHPWR 接口数", type: "number", placeholder: "例如：0" },
    ],
    summary: (spec) =>
      joinParts([
        typeof spec.lengthMm === "number" ? `${spec.lengthMm}mm` : undefined,
        typeof spec.tdpWatts === "number" ? `${spec.tdpWatts}W` : undefined,
      ]),
  },
  ram: {
    label: "内存",
    badge: "RAM",
    fields: [
      { key: "ddrType", label: "内存代际", type: "select", options: RAM_TYPE_OPTIONS },
      { key: "sticks", label: "条数", type: "number", placeholder: "例如：2" },
    ],
    summary: (spec) =>
      joinParts([
        typeof spec.ddrType === "string" ? spec.ddrType : undefined,
        typeof spec.sticks === "number" ? `${spec.sticks} 条` : undefined,
      ]),
  },
  storage: {
    label: "SSD/HDD",
    badge: "SSD",
    fields: [
      { key: "interface", label: "接口类型", type: "select", options: STORAGE_INTERFACE_OPTIONS },
    ],
    summary: (spec) =>
      joinParts([
        spec.interface === "m2_nvme"
          ? "M.2 NVMe"
          : spec.interface === "sata"
            ? "SATA"
            : undefined,
      ]),
  },
  psu: {
    label: "电源",
    badge: "PSU",
    fields: [
      { key: "ratedWatts", label: "额定功率（W）", type: "number", placeholder: "例如：750" },
      { key: "pcie8pin", label: "PCIe 8pin 接口数", type: "number", placeholder: "例如：2" },
      { key: "twelveVhpwr", label: "12VHPWR 接口数", type: "number", placeholder: "例如：0" },
    ],
    summary: (spec) =>
      joinParts([typeof spec.ratedWatts === "number" ? `${spec.ratedWatts}W` : undefined]),
  },
  cooler: {
    label: "散热器",
    badge: "COOL",
    fields: [
      {
        key: "supportedSockets",
        label: "支持插槽（逗号分隔）",
        type: "text",
        placeholder: "例如：AM5, LGA1700",
      },
      { key: "heightMm", label: "高度（mm）", type: "number", placeholder: "例如：158" },
    ],
    summary: (spec) =>
      joinParts([
        Array.isArray(spec.supportedSockets) ? spec.supportedSockets.join("/") : undefined,
        typeof spec.heightMm === "number" ? `${spec.heightMm}mm` : undefined,
      ]),
  },
  case: {
    label: "机箱",
    badge: "CASE",
    fields: [
      {
        key: "supportedFormFactors",
        label: "支持板型（逗号分隔）",
        type: "text",
        placeholder: "例如：mATX, ITX",
      },
      { key: "maxGpuLengthMm", label: "显卡限长（mm）", type: "number", placeholder: "例如：360" },
      {
        key: "maxCoolerHeightMm",
        label: "散热器限高（mm）",
        type: "number",
        placeholder: "例如：170",
      },
    ],
    summary: (spec) =>
      joinParts([
        Array.isArray(spec.supportedFormFactors) ? spec.supportedFormFactors.join("/") : undefined,
        typeof spec.maxGpuLengthMm === "number" ? `显卡限长 ${spec.maxGpuLengthMm}mm` : undefined,
        typeof spec.maxCoolerHeightMm === "number"
          ? `散热器限高 ${spec.maxCoolerHeightMm}mm`
          : undefined,
      ]),
  },
};

export const CATEGORY_ORDER: BuildItemCategory[] = [
  "cpu",
  "motherboard",
  "gpu",
  "ram",
  "storage",
  "psu",
  "cooler",
  "case",
];

export function buildSpecPayload(
  meta: CategoryMeta,
  values: Record<string, string>,
): { spec: ItemSpec; error: string | null } {
  const spec: ItemSpec = {};
  for (const field of meta.fields) {
    const raw = values[field.key]?.trim();
    if (!raw) continue;
    if (field.type === "number") {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { spec: {}, error: `${field.label}需要填写正整数。` };
      }
      spec[field.key] = parsed;
      continue;
    }
    if (field.key === "supportedSockets" || field.key === "supportedFormFactors") {
      const list = raw
        .split(/[,，、]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (list.length === 0) {
        return { spec: {}, error: `${field.label}至少需要填写一项。` };
      }
      spec[field.key] = list;
      continue;
    }
    spec[field.key] = raw;
  }
  return { spec, error: null };
}

export function hasAnySpec(spec: ItemSpec): boolean {
  return Object.values(spec).some((value) => value !== undefined);
}

/** 反向映射：领域规格 → 表单字段字符串（编辑回填用；与 buildSpecPayload 互为逆操作） */
export function specToFormValues(meta: CategoryMeta, spec: ItemSpec): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of meta.fields) {
    const raw = spec[field.key];
    if (raw === undefined) continue;
    values[field.key] = Array.isArray(raw) ? raw.join(", ") : String(raw);
  }
  return values;
}
