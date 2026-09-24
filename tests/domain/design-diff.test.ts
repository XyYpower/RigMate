import { describe, expect, it } from "vitest";
import { diffProposals } from "@/domain/design/diff";
import type { DesignProposal } from "@/contracts/design";
import type { BuildItemCategory } from "@/domain/build/types";

function proposalOf(items: Array<[BuildItemCategory, string]>): DesignProposal {
  return {
    id: "00000000-0000-4000-8000-00000000abcd",
    requestId: "00000000-0000-4000-8000-00000000ef01",
    version: 2,
    status: "ready",
    title: "测试",
    summary: "测试",
    budgetCents: 2_000_000,
    estimatedLowCents: 1,
    estimatedHighCents: 2,
    items: items.map(([category, label]) => ({
      category,
      label,
      spec: {},
      sourceLevel: "verified_catalog" as const,
      priceEstimateLowCents: null,
      priceEstimateHighCents: null,
      priceBasis: "experience_estimate" as const,
      rationale: "测试",
      confirmationRequired: false,
    })),
    fitNotes: [],
    tradeoffs: [],
    unknowns: [],
    compatibility: { status: "ok", message: "ok", blockCount: 0, warnCount: 0, unknownCount: 0, passCount: 0 },
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  };
}

describe("方案版本差异（M32）", () => {
  it("换件：同类别的旧型号→新型号，未变化的类别不出现", () => {
    const previous = proposalOf([
      ["cpu", "AMD Ryzen 7 9800X3D"],
      ["gpu", "NVIDIA RTX 4070 SUPER（参考规格）"],
      ["psu", "华硕 TUF Gaming 850W Gold ATX 3.0"],
    ]);
    const current = proposalOf([
      ["cpu", "AMD Ryzen 7 9800X3D"],
      ["gpu", "NVIDIA RTX 4060（参考规格）"],
      ["psu", "振华 鑫铜 650W（80+ 铜牌）"],
    ]);
    const changes = diffProposals(previous, current);
    expect(changes).toEqual([
      { category: "gpu", fromLabel: "NVIDIA RTX 4070 SUPER（参考规格）", toLabel: "NVIDIA RTX 4060（参考规格）" },
      { category: "psu", fromLabel: "华硕 TUF Gaming 850W Gold ATX 3.0", toLabel: "振华 鑫铜 650W（80+ 铜牌）" },
    ]);
  });

  it("移除与新增：fromLabel/toLabel 为 null", () => {
    const previous = proposalOf([["psu", "振华 鑫铜 650W（80+ 铜牌）"]]);
    const current = proposalOf([["cooler", "利民 PA120 SE 双塔风冷"]]);
    const changes = diffProposals(previous, current);
    expect(changes).toContainEqual({ category: "psu", fromLabel: "振华 鑫铜 650W（80+ 铜牌）", toLabel: null });
    expect(changes).toContainEqual({ category: "cooler", fromLabel: null, toLabel: "利民 PA120 SE 双塔风冷" });
  });

  it("第 1 版（无上一版）差异为空", () => {
    expect(diffProposals(null, proposalOf([["cpu", "测试 CPU"]]))).toEqual([]);
  });
});
