import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, gateFieldQuality, makeFinding, unknownFinding } from "./helpers";

/**
 * 主板供电 vs CPU 功耗上限（hw-agent 数据集口径）：
 * target_cpu_tdp 是官网标称支持的 CPU 功耗上限（如「Supports up to 170W」），
 * vrm_score（相数×安数，400-2860 差 7 倍）是供电能力定序。
 * CPU PTP 峰值超过主板标称上限 → 满载触发降频保护，warn（能点亮但持续性能受损）。
 */
export function checkMotherboardCpuPower(items: BuildItem[]): Finding | null {
  const cpu = firstOf(items, "cpu");
  const motherboard = firstOf(items, "motherboard");
  if (!cpu || !motherboard) return null;
  // 官网未标称的型号（二线品牌大量 null）不适用——绝不按系列推断
  if (motherboard.spec.targetCpuTdpWatts === undefined) return null;

  const itemIds = [cpu.id, motherboard.id];
  if (cpu.spec.ptpMaxWatts === undefined && cpu.spec.tdpWatts === undefined) {
    return unknownFinding("R-MB-CPU-002", itemIds, ["CPU 峰值功耗（PTP）"]);
  }
  const qualityGate = gateFieldQuality("R-MB-CPU-002", itemIds, [
    { item: motherboard, field: "targetCpuTdpWatts", label: "主板支持的 CPU 功耗上限" },
    ...(cpu.spec.ptpMaxWatts !== undefined
      ? [{ item: cpu, field: "ptpMaxWatts", label: "CPU 峰值功耗" as const }]
      : [{ item: cpu, field: "tdpWatts", label: "CPU TDP 功耗" as const }]),
  ]);
  if (qualityGate) return qualityGate;

  const cpuWatts = cpu.spec.ptpMaxWatts ?? cpu.spec.tdpWatts ?? 0;
  const targetWatts = motherboard.spec.targetCpuTdpWatts ?? 0;

  if (cpuWatts > targetWatts) {
    return makeFinding({
      ruleId: "R-MB-CPU-002",
      status: "warn",
      itemIds,
      conclusion: `CPU 峰值功耗 ${cpuWatts}W 超过主板标称支持的 CPU 功耗上限 ${targetWatts}W，满载会触发降频保护。`,
      evidence: [
        `CPU 记录峰值功耗 ${cpuWatts}W。`,
        `主板标称支持 CPU 功耗上限 ${targetWatts}W。`,
      ],
      suggestedAction: "选择供电规格更高的主板，或搭配功耗上限以内的 CPU。",
    });
  }

  return makeFinding({
    ruleId: "R-MB-CPU-002",
    status: "pass",
    itemIds,
    conclusion: `CPU 峰值功耗 ${cpuWatts}W 在主板标称支持上限 ${targetWatts}W 内。`,
    evidence: [`主板标称支持 CPU 功耗上限 ${targetWatts}W。`],
    suggestedAction: "继续检查存储接口与主板端口。",
  });
}
