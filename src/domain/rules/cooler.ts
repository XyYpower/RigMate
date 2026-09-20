import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, makeFinding, normalizeSpecValue, unknownFinding } from "./helpers";

export function checkCoolerSocket(items: BuildItem[]): Finding | null {
  const cpu = firstOf(items, "cpu");
  const cooler = firstOf(items, "cooler");
  if (!cpu || !cooler) return null;

  const itemIds = [cpu.id, cooler.id];
  const socket = cpu.spec.socket;
  const supportedSockets = cooler.spec.supportedSockets;

  if (!socket || !supportedSockets) {
    return unknownFinding("R-COOLER-001", itemIds, [
      ...(socket ? [] : ["CPU 插槽"]),
      ...(supportedSockets ? [] : ["散热器支持插槽列表"]),
    ]);
  }

  const normalizedSocket = normalizeSpecValue(socket);
  const supported = supportedSockets.map(normalizeSpecValue);

  if (!supported.includes(normalizedSocket)) {
    return makeFinding({
      ruleId: "R-COOLER-001",
      status: "block",
      itemIds,
      conclusion: `散热器支持插槽（${supported.join("、")}）不包含 CPU 插槽 ${normalizedSocket}。`,
      evidence: [`CPU 记录插槽为 ${normalizedSocket}。`, `散热器记录支持 ${supported.join("、")}。`],
      suggestedAction: "更换支持该插槽的散热器，或确认附带的扣具平台。",
    });
  }

  return makeFinding({
    ruleId: "R-COOLER-001",
    status: "pass",
    itemIds,
    conclusion: `散热器支持 CPU 插槽 ${normalizedSocket}。`,
    evidence: [`散热器记录支持 ${supported.join("、")}。`],
    suggestedAction: "继续检查散热器高度与机箱限高。",
  });
}
