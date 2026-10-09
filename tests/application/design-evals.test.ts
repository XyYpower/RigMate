import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  measureSelectionGain,
  runDesignEvalCase,
  summarizeEvalResults,
  type DesignEvalCase,
} from "@/application/design/evals";
import { buildCandidatePool, type RankedCandidate } from "@/domain/catalog/ranking";
import { fixtureCatalogEntries, fixtureVerifiedPriceMap } from "@/infra/catalog-import/fixture";
import { parseDesignIntent } from "@/domain/design/intent";

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

  it("可测量增益：同一 CandidateSet 上模型选择相对规则排序的价差可量化（v2 Phase 6）", () => {
    // 场景：2 万预算内 4070S（¥4,999）与 4060（¥2,399）都合规。规则排序按"预算内更高档"
    // 选 4070S；脚本化模型以"预算优先"策略选 4060。两者都过质量门，增益 = 价差 ¥2,600。
    const intent = parseDesignIntent({ rawInput: "2 万预算，剪辑和游戏" });
    const { pool } = buildCandidatePool(
      entries,
      intent,
      ["gpu"],
      prices,
    );
    const rulePick = { gpu: "gpu-rtx4070s" };
    const modelPick = { gpu: "gpu-rtx4060" };

    const gain = measureSelectionGain(pool, rulePick, modelPick);
    expect(gain.comparable).toBe(1);
    expect(gain.byCategory.gpu).toBe(2_600_00);
    expect(gain.totalCents).toBe(2_600_00);

    // 反向同样可量化：模型选更高档时增益为负（诚实记录，不做方向美化）
    const reverse = measureSelectionGain(pool, { gpu: "gpu-rtx4060" }, { gpu: "gpu-rtx4070s" });
    expect(reverse.totalCents).toBe(-2_600_00);

    // 一侧无选择或无价格：记为不可比较，不产生幻觉增益
    const incomparable = measureSelectionGain(pool, { gpu: "gpu-rtx4070s" }, {});
    expect(incomparable.byCategory.gpu).toBeNull();
    expect(incomparable.totalCents).toBe(0);
  });
});
