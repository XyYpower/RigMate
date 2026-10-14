import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, gateFieldQuality, makeFinding, unknownFinding } from "./helpers";

/**
 * 内存马甲高度 vs 散热器内存避让间隙（hw-agent 数据集口径）：
 * 数据集在内存 height_mm 与散热器 memory_clearance_mm 上都给了明确数值，
 * 马甲高度超过避让间隙 = 物理装不上，block；散热器无该字段（水冷）不适用。
 */
export function checkCoolerRamClearance(items: BuildItem[]): Finding | null {
  const cooler = firstOf(items, "cooler");
  const ram = firstOf(items, "ram");
  if (!cooler || !ram) return null;
  // 水冷/无数据（memoryClearanceMm 缺省）不适用——数据集只有塔式风冷带该字段
  if (cooler.spec.memoryClearanceMm === undefined) return null;

  const itemIds = [cooler.id, ram.id];
  if (ram.spec.heightMm === undefined) {
    return unknownFinding("R-COOLER-RAM-001", itemIds, ["内存马甲高度"]);
  }
  const qualityGate = gateFieldQuality("R-COOLER-RAM-001", itemIds, [
    { item: cooler, field: "memoryClearanceMm", label: "散热器内存避让间隙" },
    { item: ram, field: "heightMm", label: "内存马甲高度" },
  ]);
  if (qualityGate) return qualityGate;

  const clearance = cooler.spec.memoryClearanceMm ?? 0;
  const height = ram.spec.heightMm ?? 0;

  if (height > clearance) {
    return makeFinding({
      ruleId: "R-COOLER-RAM-001",
      status: "block",
      itemIds,
      conclusion: `内存马甲高度 ${height}mm 超过散热器内存避让间隙 ${clearance}mm，与塔式散热器物理冲突。`,
      evidence: [
        `内存记录马甲高度 ${height}mm。`,
        `散热器记录内存避让间隙 ${clearance}mm。`,
      ],
      suggestedAction: "更换矮马甲内存、上移散热器风扇，或改用一体式水冷。",
    });
  }

  return makeFinding({
    ruleId: "R-COOLER-RAM-001",
    status: "pass",
    itemIds,
    conclusion: `内存马甲高度 ${height}mm 在散热器避让间隙 ${clearance}mm 内。`,
    evidence: [`散热器记录内存避让间隙 ${clearance}mm。`],
    suggestedAction: "继续检查散热器与机箱的限高。",
  });
}
