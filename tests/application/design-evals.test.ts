import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDesignEvalCase, summarizeEvalResults, type DesignEvalCase } from "@/application/design/evals";
import { fixtureCatalogEntries, fixtureVerifiedPriceMap } from "@/infra/catalog-import/fixture";
import type { RankedCandidate } from "@/domain/catalog/ranking";

/**
 * 受约束选件固定评测（内核恢复计划 Task D）：
 * 预算 / 剪辑+游戏 / 白色外观 / 已有电源 / 商家自拟名 / 无匹配（候选不足由 ranking 单测覆盖空池分支）
 * / 超时 / 非法 ID / 越权字段。unsupported claim rate 必须为 0。
 */

const casesFile = JSON.parse(readFileSync("data/evals/design-selection-cases.json", "utf8")) as {
  cases: DesignEvalCase[];
};

const entries = fixtureCatalogEntries().filter((entry) => entry.qualityStatus !== "partial") as RankedCandidate[];
const prices = fixtureVerifiedPriceMap();

describe("受约束选件固定评测", () => {
  it("案例文件覆盖九类场景", () => {
    expect(casesFile.cases.length).toBeGreaterThanOrEqual(9);
  });

  for (const testCase of casesFile.cases) {
    it(`案例 ${testCase.id} 通过且无 unsupported claim`, async () => {
      const result = await runDesignEvalCase(testCase, { entries, priceByCanonicalId: prices });
      expect(result.failures, result.failures.join("；")).toEqual([]);
      expect(result.unsupportedClaims, result.unsupportedClaims.join("；")).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }

  it("汇总：unsupported claim rate 为 0", async () => {
    const results = [];
    for (const testCase of casesFile.cases) {
      results.push(await runDesignEvalCase(testCase, { entries, priceByCanonicalId: prices }));
    }
    const summary = summarizeEvalResults(results);
    expect(summary.failed).toEqual([]);
    expect(summary.unsupportedClaimRate).toBe(0);
  });
});
