import { describe, expect, it } from "vitest";
import { createSearchCatalogTool } from "@/application/agent/tools/catalog-tools";
import type { RankedCandidate } from "@/domain/catalog/ranking";

// M2 Task 4：searchCatalog 工具切分桶召回——queries 激活 exact/alias 桶与动态 K，
// 摘要带 bucket 与 decisionSpecs，硬约束不在此过滤（方案层规则裁决）。

function entryOf(overrides: Partial<RankedCandidate> & { id: string; name: string }): RankedCandidate {
  return {
    category: "gpu",
    aliases: [],
    spec: {},
    qualityStatus: "supported",
    ...overrides,
  };
}

const ENTRIES: RankedCandidate[] = [
  entryOf({ id: "gpu-4070s", name: "RTX 4070 SUPER", aliases: ["4070s"], spec: { tier: 7, tdpWatts: 220 } }),
  ...Array.from({ length: 8 }, (_, i) =>
    entryOf({ id: `gpu-filler-${i}`, name: `Filler GPU ${i}`, spec: { tier: 5 } }),
  ),
];

describe("searchCatalog 工具（分桶召回）", () => {
  const tool = createSearchCatalogTool({ entries: ENTRIES, priceByCanonicalId: new Map() });

  it("默认每类 6 条，摘要带 bucket 与 decisionSpecs", () => {
    const result = tool({ category: "gpu", intent: undefined });
    expect(result).toHaveLength(6);
    for (const candidate of result) {
      expect(candidate.bucket).toBe("ranked");
      expect(candidate.decisionSpecs).toBeDefined();
    }
  });

  it("queries 点名型号：exact 桶置顶且扩 K", () => {
    const result = tool({ category: "gpu", intent: undefined, queries: ["换成 4070S"] });
    expect(result[0]?.canonicalId).toBe("gpu-4070s");
    expect(result[0]?.bucket).toBe("exact");
    expect(result.length).toBeGreaterThan(6);
  });

  it("partial 质量门外候选绝不出现", () => {
    const entries = [...ENTRIES, { ...entryOf({ id: "gpu-bad", name: "Bad GPU" }), qualityStatus: "partial" as const }];
    const strictTool = createSearchCatalogTool({ entries, priceByCanonicalId: new Map() });
    const ids = strictTool({ category: "gpu", intent: undefined, queries: ["Bad GPU"] }).map((c) => c.canonicalId);
    expect(ids).not.toContain("gpu-bad");
  });
});
