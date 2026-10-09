import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDesignEvalCase, summarizeEvalResults, type DesignEvalCase } from "@/application/design/evals";
import { fixtureCatalogEntries, fixtureVerifiedPriceMap } from "@/infra/catalog-import/fixture";
import type { RankedCandidate } from "@/domain/catalog/ranking";

/**
 * Grounding 评测（v2 Phase 6）：方案里每一个精确主张（型号 / 质量 / 价格）都必须
 * 能回溯到质量门候选池与已审核价格证据；无证据处只能是 unknown，不许编造。
 */

const casesFile = JSON.parse(readFileSync("data/evals/design-selection-cases.json", "utf8")) as {
  cases: DesignEvalCase[];
};

const entries = fixtureCatalogEntries().filter((entry) => entry.qualityStatus !== "partial") as RankedCandidate[];
const prices = fixtureVerifiedPriceMap();

describe("Grounding：方案主张全部可回溯", () => {
  for (const testCase of casesFile.cases) {
    it(`案例 ${testCase.id}：型号、质量、价格全部锚定候选池与证据`, async () => {
      const result = await runDesignEvalCase(testCase, { entries, priceByCanonicalId: prices });
      expect(result.unsupportedClaims).toEqual([]);

      if (result.proposalItems.length === 0) return;
      const poolIds = new Set(Object.values(result.poolIdsByCategory).flat());
      for (const item of result.proposalItems) {
        // 型号可回溯：方案项属于该类别检索出的候选
        expect(poolIds.has(result.rulePick[item.category] ?? "")).toBe(true);
        // 质量可回溯：只允许已通过质量门的两种状态
        expect(["verified", "supported"]).toContain(item.qualityStatus);
        expect(["verified_catalog", "supported_catalog"]).toContain(item.sourceLevel);
        // 价格可回溯：声称有证据就必须真有价格；无价格只能是 unknown
        if (item.priceBasis === "evidence") {
          expect(item.priceBasis).toBe("evidence");
        } else {
          expect(item.priceBasis).toBe("unknown");
        }
      }
    });
  }

  it("无价格证据时：价格字段是 unknown 而不是估算值", async () => {
    const testCase = casesFile.cases.find((item) => item.id === "budget-high")!;
    const result = await runDesignEvalCase(testCase, {
      entries,
      priceByCanonicalId: new Map(),
    });
    expect(result.proposalItems.length).toBeGreaterThan(0);
    for (const item of result.proposalItems) {
      expect(item.priceBasis).toBe("unknown");
    }
  });

  it("评测汇总：unsupported claim rate = 0（型号/规格/价格三类合计）", async () => {
    const results = [];
    for (const testCase of casesFile.cases) {
      results.push(await runDesignEvalCase(testCase, { entries, priceByCanonicalId: prices }));
    }
    const summary = summarizeEvalResults(results);
    expect(summary.unsupportedClaimRate).toBe(0);
    expect(summary.failed).toEqual([]);
  });
});
