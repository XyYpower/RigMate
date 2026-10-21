import { describe, expect, it } from "vitest";
import { makeItem } from "./cpu-motherboard.test";
import { checkCpuGpuTierBalance } from "@/domain/rules/balance";

// R-BALANCE-001 CPU/显卡档位均衡（配件合理性）：四态纪律——
// 失衡 warn（含方向指引）/ 均衡 pass / 档位缺失 unknown / 质量门拦截。

describe("R-BALANCE-001 CPU/显卡档位均衡", () => {
  it("档位差 <4 → pass", () => {
    const finding = checkCpuGpuTierBalance([
      makeItem({ category: "cpu", label: "9800X3D", spec: { tier: 9 } }),
      makeItem({ category: "gpu", label: "4070 SUPER", spec: { tier: 7 } }),
    ]);
    expect(finding?.status).toBe("pass");
    expect(finding?.conclusion).toContain("均衡");
  });

  it("高 U 低显 ≥4 档 → warn + 游戏侧方向指引", () => {
    const finding = checkCpuGpuTierBalance([
      makeItem({ category: "cpu", label: "Threadripper", spec: { tier: 10 } }),
      makeItem({ category: "gpu", label: "入门卡", spec: { tier: 3 } }),
    ]);
    expect(finding?.status).toBe("warn");
    expect(finding?.conclusion).toContain("偏处理器");
    expect(finding?.suggestedAction).toContain("把预算移向显卡");
  });

  it("高显低 U ≥4 档 → warn + 生产力侧取舍说明（不一刀切判错）", () => {
    const finding = checkCpuGpuTierBalance([
      makeItem({ category: "cpu", label: "入门 U", spec: { tier: 3 } }),
      makeItem({ category: "gpu", label: "旗舰卡", spec: { tier: 10 } }),
    ]);
    expect(finding?.status).toBe("warn");
    expect(finding?.conclusion).toContain("偏显卡");
    expect(finding?.suggestedAction).toContain("生产力为主");
  });

  it("任一档位缺失 → unknown（不猜）", () => {
    const finding = checkCpuGpuTierBalance([
      makeItem({ category: "cpu", label: "旧 U", spec: {} }),
      makeItem({ category: "gpu", label: "4070 SUPER", spec: { tier: 7 } }),
    ]);
    expect(finding?.status).toBe("unknown");
    expect(finding?.missingFields).toEqual(["CPU 性能档位", "显卡性能档位"]);
  });

  it("缺 CPU 或缺 GPU 时不适用", () => {
    expect(checkCpuGpuTierBalance([makeItem({ category: "cpu", spec: { tier: 9 } })])).toBeNull();
    expect(checkCpuGpuTierBalance([])).toBeNull();
  });
});
