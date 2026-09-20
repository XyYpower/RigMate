import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, makeFinding, unknownFinding } from "./helpers";

const OTHER_COMPONENTS_BASELINE_WATTS = 80;
const PSU_WARN_MARGIN_RATIO = 0.8;

export function checkPsuCapacity(items: BuildItem[]): Finding | null {
  const psu = firstOf(items, "psu");
  const cpu = firstOf(items, "cpu");
  const gpu = firstOf(items, "gpu");
  if (!psu || (!cpu && !gpu)) return null;

  const itemIds = [psu.id, ...(cpu ? [cpu.id] : []), ...(gpu ? [gpu.id] : [])];

  const missingFields: string[] = [];
  if (!cpu) missingFields.push("CPU（未添加条目，无法估算功耗）");
  else if (cpu.spec.tdpWatts === undefined) missingFields.push("CPU TDP 功耗");
  if (!gpu) missingFields.push("显卡（未添加条目，无法估算功耗）");
  else if (gpu.spec.tdpWatts === undefined) missingFields.push("显卡 TDP 功耗");
  if (psu.spec.ratedWatts === undefined) missingFields.push("电源额定功率");
  if (missingFields.length > 0) {
    return unknownFinding("R-PSU-001", itemIds, missingFields);
  }

  const requiredWatts =
    (cpu?.spec.tdpWatts ?? 0) + (gpu?.spec.tdpWatts ?? 0) + OTHER_COMPONENTS_BASELINE_WATTS;
  const ratedWatts = psu.spec.ratedWatts ?? 0;

  const assumptions = [
    `按 CPU TDP + 显卡 TDP + ${OTHER_COMPONENTS_BASELINE_WATTS}W（主板/内存/存储/风扇估算基线）计算。`,
    "未计算瞬时功耗峰值，仅作粗粒度参考。",
  ];

  if (requiredWatts >= ratedWatts) {
    return makeFinding({
      ruleId: "R-PSU-001",
      status: "block",
      itemIds,
      conclusion: `估算整机需求约 ${requiredWatts}W，达到或超过电源额定 ${ratedWatts}W。`,
      evidence: [`电源记录额定功率 ${ratedWatts}W。`],
      assumptions,
      suggestedAction: "更换额定功率更高的电源，或降低整机功耗配置。",
    });
  }

  if (requiredWatts > ratedWatts * PSU_WARN_MARGIN_RATIO) {
    return makeFinding({
      ruleId: "R-PSU-001",
      status: "warn",
      itemIds,
      conclusion: `估算整机需求约 ${requiredWatts}W，电源额定 ${ratedWatts}W，余量不足 20%。`,
      evidence: [`电源记录额定功率 ${ratedWatts}W。`],
      assumptions,
      suggestedAction: "余量偏紧，建议选择额定功率更高的电源，或确认官方功耗建议。",
    });
  }

  return makeFinding({
    ruleId: "R-PSU-001",
    status: "pass",
    itemIds,
    conclusion: `估算整机需求约 ${requiredWatts}W，电源额定 ${ratedWatts}W，余量充足。`,
    evidence: [`电源记录额定功率 ${ratedWatts}W。`],
    assumptions,
    suggestedAction: "继续检查供电接口是否匹配。",
  });
}

export function checkPsuConnectors(items: BuildItem[]): Finding | null {
  const gpu = firstOf(items, "gpu");
  const psu = firstOf(items, "psu");
  if (!gpu || !psu) return null;

  const itemIds = [gpu.id, psu.id];
  const gpuConnectors = gpu.spec;
  const psuConnectors = psu.spec;

  const missingFields: string[] = [];
  if (gpuConnectors.pcie8pin === undefined && gpuConnectors.twelveVhpwr === undefined) {
    missingFields.push("显卡供电接口");
  }
  if (psuConnectors.pcie8pin === undefined && psuConnectors.twelveVhpwr === undefined) {
    missingFields.push("电源供电接口");
  }
  if (missingFields.length > 0) {
    return unknownFinding("R-PSU-002", itemIds, missingFields);
  }

  const needed8pin = gpuConnectors.pcie8pin ?? 0;
  const needed12vhpwr = gpuConnectors.twelveVhpwr ?? 0;
  const provided8pin = psuConnectors.pcie8pin ?? 0;
  const provided12vhpwr = psuConnectors.twelveVhpwr ?? 0;

  if (needed8pin > provided8pin || needed12vhpwr > provided12vhpwr) {
    return makeFinding({
      ruleId: "R-PSU-002",
      status: "block",
      itemIds,
      conclusion: "电源供电接口数量不能满足显卡需求。",
      evidence: [
        `显卡需要：PCIe 8pin ×${needed8pin}、12VHPWR ×${needed12vhpwr}。`,
        `电源提供：PCIe 8pin ×${provided8pin}、12VHPWR ×${provided12vhpwr}。`,
      ],
      suggestedAction: "更换接口配置匹配的电源，或选择接口需求更低的显卡。",
    });
  }

  return makeFinding({
    ruleId: "R-PSU-002",
    status: "pass",
    itemIds,
    conclusion: "电源供电接口满足显卡需求。",
    evidence: [
      `显卡需要：PCIe 8pin ×${needed8pin}、12VHPWR ×${needed12vhpwr}。`,
      `电源提供：PCIe 8pin ×${provided8pin}、12VHPWR ×${provided12vhpwr}。`,
    ],
    suggestedAction: "继续检查其他兼容性条件。",
  });
}
