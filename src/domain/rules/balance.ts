import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, gateFieldQuality, makeFinding, unknownFinding } from "./helpers";

/**
 * CPU/显卡档位均衡（配件合理性，Alpha 自测反馈 2026-10-16）：
 * 数据集 tier（1-10 档）是定序权威。两件档位差 ≥4 视为失衡——
 * 游戏场景头重脚轻（高 U 低显）或显卡瓶颈（高显低 U）都会让整机的钱花偏。
 * 规则只指出失衡与两个方向的可能，不替用户决定：生产力用途 CPU 优先是合理取舍。
 * 档位缺失时不猜（unknown）。
 */
export function checkCpuGpuTierBalance(items: BuildItem[]): Finding | null {
  const cpu = firstOf(items, "cpu");
  const gpu = firstOf(items, "gpu");
  if (!cpu || !gpu) return null;

  const itemIds = [cpu.id, gpu.id];
  const cpuTier = cpu.spec.tier;
  const gpuTier = gpu.spec.tier;
  if (typeof cpuTier !== "number" || typeof gpuTier !== "number") {
    return unknownFinding("R-BALANCE-001", itemIds, ["CPU 性能档位", "显卡性能档位"]);
  }
  const qualityGate = gateFieldQuality("R-BALANCE-001", itemIds, [
    { item: cpu, field: "tier", label: "CPU 性能档位" },
    { item: gpu, field: "tier", label: "显卡性能档位" },
  ]);
  if (qualityGate) return qualityGate;

  const gap = Math.abs(cpuTier - gpuTier);
  if (gap < 4) {
    return makeFinding({
      ruleId: "R-BALANCE-001",
      status: "pass",
      itemIds,
      conclusion: `处理器与显卡档位均衡（${cpuTier} 档 vs ${gpuTier} 档），预算分配没有明显偏科。`,
      evidence: [`CPU 档位 ${cpuTier}/10。`, `显卡档位 ${gpuTier}/10。`],
      suggestedAction: "保持即可；有明确侧重（如直播推流）再手动调整。",
    });
  }

  const cpuFirst = cpuTier > gpuTier;
  return makeFinding({
    ruleId: "R-BALANCE-001",
    status: "warn",
    itemIds,
    conclusion: `处理器（${cpuTier} 档）与显卡（${gpuTier} 档）相差 ${gap} 档，整机预算${cpuFirst ? "偏处理器" : "偏显卡"}。`,
    evidence: [
      `CPU 档位 ${cpuTier}/10，显卡档位 ${gpuTier}/10。`,
      cpuFirst
        ? "游戏场景显卡通常是帧数瓶颈，高档 CPU 的性能可能发挥不完全。"
        : "游戏场景这个组合是合理的显卡优先配置；但重 CPU 场景（编译/多开/模拟器）可能吃满处理器。",
    ],
    suggestedAction: cpuFirst
      ? "游戏为主可把预算移向显卡或降低 CPU 档位；剪辑/编译/多开为主则这个偏科是合理取舍，保留即可。"
      : "游戏为主可以保留（显卡优先是主流思路）；生产力为主建议向处理器回补一档。",
  });
}
