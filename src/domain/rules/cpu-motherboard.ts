import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, makeFinding, normalizeSpecValue, unknownFinding } from "./helpers";

export function checkCpuMotherboardSocket(items: BuildItem[]): Finding | null {
  const cpu = firstOf(items, "cpu");
  const motherboard = firstOf(items, "motherboard");

  if (!cpu || !motherboard) {
    return null;
  }

  const itemIds = [cpu.id, motherboard.id];
  const cpuSocket = cpu.spec.socket;
  const motherboardSocket = motherboard.spec.socket;

  if (!cpuSocket || !motherboardSocket) {
    return unknownFinding("R-CPU-MB-001", itemIds, [
      ...(cpuSocket ? [] : ["CPU 插槽"]),
      ...(motherboardSocket ? [] : ["主板插槽"]),
    ]);
  }

  const normalizedCpuSocket = normalizeSpecValue(cpuSocket);
  const normalizedMotherboardSocket = normalizeSpecValue(motherboardSocket);

  if (normalizedCpuSocket !== normalizedMotherboardSocket) {
    return makeFinding({
      ruleId: "R-CPU-MB-001",
      status: "block",
      itemIds,
      conclusion: `CPU 插槽 ${normalizedCpuSocket} 与主板插槽 ${normalizedMotherboardSocket} 不匹配。`,
      evidence: [`CPU 记录为 ${normalizedCpuSocket}。`, `主板记录为 ${normalizedMotherboardSocket}。`],
      suggestedAction: "更换 CPU 或主板，使两者使用相同插槽平台。",
    });
  }

  return makeFinding({
    ruleId: "R-CPU-MB-001",
    status: "pass",
    itemIds,
    conclusion: `CPU 与主板都使用 ${normalizedCpuSocket} 插槽，基础插槽匹配。`,
    evidence: [`CPU 记录为 ${normalizedCpuSocket}。`, `主板记录为 ${normalizedMotherboardSocket}。`],
    assumptions: ["本条规则只检查插槽，不代表 BIOS、芯片组和供电一定满足。"],
    suggestedAction: "继续检查内存代际、供电和机箱空间等条件。",
  });
}
