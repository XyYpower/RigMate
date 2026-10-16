import type { BuildItemCategory } from "@/domain/build/types";

/**
 * decisionSpecs 白名单（blueprint §6.2）：每类只把规则引擎消费 + 取舍解释需要的
 * 决策字段透给模型——"比较机箱时传限长/限高/板型，不把 CPU 频率塞进去"。
 * 白名单的底线 = 该类规则消费的字段全集（缺了模型就无法解释兼容结论）；
 * tier 是排序性能档位，作为取舍上下文对八类通用。
 * 新规则消费新字段时必须同步补这里（decisionSpecsOf 会静默滤掉白名单外的字段）。
 */

export const DECISION_SPEC_FIELDS: Record<BuildItemCategory, readonly string[]> = {
  cpu: ["socket", "tdpWatts", "ptpMaxWatts", "hasIgpu", "m2Lanes", "tier"],
  motherboard: [
    "socket",
    "formFactor",
    "ramType",
    "ramSlots",
    "m2Slots",
    "sataPorts",
    "pcieX16Slots",
    "targetCpuTdpWatts",
    "vrmScore",
    "tier",
  ],
  gpu: ["tdpWatts", "pcie8pin", "twelveVhpwr", "lengthMm", "vramGb", "tier"],
  ram: ["ddrType", "sticks", "heightMm", "tier"],
  storage: ["interface", "tier"],
  psu: ["ratedWatts", "pcie8pin", "twelveVhpwr", "tier"],
  cooler: ["socket", "supportedSockets", "heightMm", "memoryClearanceMm", "tier"],
  case: ["supportedFormFactors", "maxGpuLengthMm", "maxCoolerHeightMm", "tier"],
};

/** 白名单投影：只保留非空（undefined/null 不透出，缺失交给 missingFields 语义） */
export function decisionSpecsOf(
  category: BuildItemCategory,
  spec: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of DECISION_SPEC_FIELDS[category]) {
    const value = spec[field];
    if (value !== undefined && value !== null) out[field] = value;
  }
  return out;
}
