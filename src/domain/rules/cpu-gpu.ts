import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, gateFieldQuality, makeFinding, unknownFinding } from "./helpers";

/**
 * 无核显 CPU 必须配独立显卡（hw-agent 数据集陷阱 4.1 跨类目高危）：
 * 数据集 51 个型号无核显（F/KF 后缀 + AMD 部分 OEM 型号），没有独显无法点亮。
 * 这是物理事实，直接 block；CPU has_igpu 数据缺失时不猜（unknown）。
 */
export function checkCpuIgpuGpu(items: BuildItem[]): Finding | null {
  const cpu = firstOf(items, "cpu");
  if (!cpu) return null;
  // 配了独显则无核显无关紧要
  const hasGpu = items.some((item) => item.category === "gpu");
  if (hasGpu) return null;

  const itemIds = [cpu.id];
  if (cpu.spec.hasIgpu === undefined) {
    return unknownFinding("R-CPU-GPU-001", itemIds, ["CPU 是否带核显"]);
  }
  const qualityGate = gateFieldQuality("R-CPU-GPU-001", itemIds, [
    { item: cpu, field: "hasIgpu", label: "CPU 是否带核显" },
  ]);
  if (qualityGate) return qualityGate;

  if (cpu.spec.hasIgpu === false) {
    return makeFinding({
      ruleId: "R-CPU-GPU-001",
      status: "block",
      itemIds,
      conclusion: `${cpu.label} 无核显，未配独立显卡时主机无法点亮。`,
      evidence: ["CPU 记录无核显（F/KF 后缀或无 iGPU 型号）。", "当前配置未包含独立显卡。"],
      suggestedAction: "添加独立显卡，或更换带核显的 CPU 型号。",
    });
  }

  return makeFinding({
    ruleId: "R-CPU-GPU-001",
    status: "pass",
    itemIds,
    conclusion: "CPU 带核显，未配独显也可点亮。",
    evidence: ["CPU 记录带核显。"],
    suggestedAction: "如需游戏或渲染性能，仍建议配置独立显卡。",
  });
}
