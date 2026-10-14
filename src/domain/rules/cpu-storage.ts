import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, gateFieldQuality, makeFinding, unknownFinding } from "./helpers";

/**
 * CPU 直连 M.2 通道（hw-agent 数据集口径）：
 * CPU 直连 M.2 通道有限（33 个型号仅 2 路，8000G/AM4 全系），主板插槽再多，
 * 超出 CPU 直连数的 M.2 要走芯片组——可用但共享带宽/降速。因此是 warn 不是 block。
 */
export function checkCpuM2Lanes(items: BuildItem[]): Finding | null {
  const cpu = firstOf(items, "cpu");
  if (!cpu) return null;

  const m2Storages = items.filter(
    (item) => item.category === "storage" && item.spec.interface === "m2_nvme",
  );
  if (m2Storages.length === 0) return null;

  const itemIds = [cpu.id, ...m2Storages.map((item) => item.id)];
  if (cpu.spec.m2Lanes === undefined) {
    return unknownFinding("R-CPU-MB-002", itemIds, ["CPU 直连 M.2 通道数"]);
  }
  const qualityGate = gateFieldQuality("R-CPU-MB-002", itemIds, [
    { item: cpu, field: "m2Lanes", label: "CPU 直连 M.2 通道数" },
  ]);
  if (qualityGate) return qualityGate;

  const lanes = cpu.spec.m2Lanes ?? 0;
  if (m2Storages.length > lanes) {
    return makeFinding({
      ruleId: "R-CPU-MB-002",
      status: "warn",
      itemIds,
      conclusion: `${m2Storages.length} 块 NVMe 超过 CPU 直连 M.2 通道数（${lanes} 路），超出的走芯片组、共享带宽。`,
      evidence: [`CPU 记录直连 M.2 通道 ${lanes} 路。`],
      assumptions: ["超出直连数的 M.2 仍可使用（经芯片组），但可能与显卡槽共享带宽或降速。"],
      suggestedAction: "确认主板芯片组 M.2 的带宽分配，或减少 NVMe 数量 / 选择直连通道更多的 CPU。",
    });
  }

  return makeFinding({
    ruleId: "R-CPU-MB-002",
    status: "pass",
    itemIds,
    conclusion: `${m2Storages.length} 块 NVMe 全部在 CPU 直连 M.2 通道（${lanes} 路）内。`,
    evidence: [`CPU 记录直连 M.2 通道 ${lanes} 路。`],
    suggestedAction: "继续检查存储接口与主板端口。",
  });
}
