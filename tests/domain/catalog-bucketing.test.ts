import { describe, expect, it } from "vitest";
import { buildCategoryCandidates, type RankedCandidate } from "@/domain/catalog/ranking";
import type { StructuredIntent } from "@/contracts/design";

// M2 Task 2：分桶召回 + 动态 K + 类目账目（blueprint §6.1 §6.3）。
// 桶序：exact（型号/别名/中文名与型号短语全等）→ alias（别名包含于短语）
//   → ranked（现有规则排序补满）→ diversity（不同性能档补召回 ≤2）。

function entryOf(overrides: Partial<RankedCandidate> & { id: string; name: string }): RankedCandidate {
  return {
    category: "gpu",
    aliases: [],
    spec: {},
    qualityStatus: "supported",
    ...overrides,
  };
}

const INTENT: StructuredIntent = {
  budgetCents: null,
  useCases: [],
  appearance: [],
  existingParts: [],
  constraints: [],
  region: "中国大陆",
};

describe("buildCategoryCandidates（分桶召回）", () => {
  const entries: RankedCandidate[] = [
    entryOf({ id: "gpu-4070s", name: "RTX 4070 SUPER（参考规格）", aliases: ["4070s", "4070 SUPER"], spec: { tier: 7 } }),
    entryOf({ id: "gpu-4060", name: "RTX 4060", aliases: ["4060"], spec: { tier: 5 } }),
    entryOf({ id: "gpu-5090", name: "RTX 5090", aliases: ["5090"], spec: { tier: 10 } }),
    entryOf({ id: "gpu-9070", name: "RX 9070 XT", aliases: ["9070xt"], spec: { tier: 8 } }),
    // 质量门外：不计入 considered 池，但记账
    { ...entryOf({ id: "gpu-partial", name: "Partial GPU", aliases: [] }), qualityStatus: "partial" },
    // 超长名称：质量门内但不进候选，记账
    entryOf({ id: "gpu-longname", name: "X".repeat(200), aliases: [] }),
  ];

  it("无型号短语：全部走 ranked 桶，默认 K=6，账目如实", () => {
    const { candidates, stats } = buildCategoryCandidates({
      entries,
      category: "gpu",
      intent: INTENT,
      queries: [],
    });
    expect(stats.considered).toBe(5); // 质量门内 5 条（含超长名）
    expect(stats.rejectedByQuality).toBe(1);
    expect(stats.rejectedByNameLength).toBe(1);
    expect(stats.pooled).toBe(4);
    for (const candidate of candidates) {
      expect(candidate.bucket).toBe("ranked");
    }
  });

  it("点名型号（run 与别名全等）→ exact 置顶并扩 K", () => {
    const { candidates } = buildCategoryCandidates({
      entries,
      category: "gpu",
      intent: INTENT,
      queries: ["换成 4070S"],
    });
    expect(candidates[0]?.canonicalId).toBe("gpu-4070s");
    expect(candidates[0]?.bucket).toBe("exact");
    // 点名型号激活 K=20：ranked 桶补满全部剩余
    expect(candidates).toHaveLength(4);
    expect(candidates[1]?.bucket).toBe("ranked");
  });

  it("短语与别名规范化后全等 → exact 桶", () => {
    const { candidates } = buildCategoryCandidates({
      entries,
      category: "gpu",
      intent: INTENT,
      queries: ["4070 SUPER"],
    });
    expect(candidates[0]?.canonicalId).toBe("gpu-4070s");
    expect(candidates[0]?.bucket).toBe("exact");
  });

  it("中文别名包含于整句（无 run）→ alias 桶", () => {
    const { candidates } = buildCategoryCandidates({
      entries: [entryOf({ id: "gpu-cruiser", name: "Colorful CVN Cruiser", aliases: ["七彩虹巡洋舰"], spec: { tier: 8 } })],
      category: "gpu",
      intent: INTENT,
      queries: ["就想用七彩虹巡洋舰"],
    });
    expect(candidates[0]?.canonicalId).toBe("gpu-cruiser");
    expect(candidates[0]?.bucket).toBe("alias");
  });

  it("中文名：短语包含 → alias 桶；全等 → exact 桶", () => {
    const contained = buildCategoryCandidates({
      entries: [entryOf({ id: "gpu-zh", name: "Some GPU", nameZh: "小雕显卡", spec: { tier: 3 } })],
      category: "gpu",
      intent: INTENT,
      queries: ["就用小雕显卡"],
    });
    expect(contained.candidates[0]?.canonicalId).toBe("gpu-zh");
    expect(contained.candidates[0]?.bucket).toBe("alias");

    const equal = buildCategoryCandidates({
      entries: [entryOf({ id: "gpu-zh", name: "Some GPU", nameZh: "小雕显卡", spec: { tier: 3 } })],
      category: "gpu",
      intent: INTENT,
      queries: ["小雕显卡"],
    });
    expect(equal.candidates[0]?.bucket).toBe("exact");
  });

  it("diversity 桶：主池之外补不同性能档 ≤2 条", () => {
    // 20 条同档 + 2 条不同档：默认 K=6，主池取前 6，diversity 补 2 条不同档
    const same = Array.from({ length: 20 }, (_, i) =>
      entryOf({ id: `gpu-same-${i}`, name: `Same Tier ${i}`, spec: { tier: 5, perfScore: 100 - i } }),
    );
    const other = [
      entryOf({ id: "gpu-tier2", name: "Low Tier", spec: { tier: 2, perfScore: 20 } }),
      entryOf({ id: "gpu-tier9", name: "High Tier", spec: { tier: 9, perfScore: 90 } }),
    ];
    const { candidates } = buildCategoryCandidates({
      entries: [...same, ...other],
      category: "gpu",
      intent: INTENT,
      queries: [],
    });
    expect(candidates).toHaveLength(8); // 6 主池 + 2 diversity
    const diversity = candidates.filter((candidate) => candidate.bucket === "diversity");
    expect(diversity.map((candidate) => candidate.canonicalId).sort()).toEqual(["gpu-tier2", "gpu-tier9"]);
  });

  it("空类目：pooled=0 且 missing 语义由调用方据 stats 判定", () => {
    const { candidates, stats } = buildCategoryCandidates({
      entries,
      category: "psu",
      intent: INTENT,
      queries: [],
    });
    expect(candidates).toHaveLength(0);
    expect(stats.pooled).toBe(0);
    expect(stats.considered).toBe(0);
  });
});
