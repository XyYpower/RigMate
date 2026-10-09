import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runDesignEvalCase, summarizeEvalResults, type DesignEvalCase, type DesignEvalCaseResult } from "../src/application/design/evals";
import { fixtureCatalogEntries, fixtureVerifiedPriceMap } from "../src/infra/catalog-import/fixture";
import type { RankedCandidate } from "../src/domain/catalog/ranking";

/**
 * 受约束选件评测运行器（内核恢复计划 Task D）：
 * 跑固定案例，生成脱敏目标报告 data/evals/report.json
 * （检索候选 / 最终选择 / 质量状态 / 价格证据 / 规则结果 / unknown 项）。
 * 评测不调用真实模型：model.* 为受控输出，守卫与规则式路径与生产一致。
 */

const casesPath = resolve("data/evals/design-selection-cases.json");
const reportPath = resolve("data/evals/report.json");

async function main(): Promise<void> {
  const file = JSON.parse(readFileSync(casesPath, "utf8")) as { cases: DesignEvalCase[] };
  const entries = fixtureCatalogEntries().filter((entry) => entry.qualityStatus !== "partial") as RankedCandidate[];
  const prices = fixtureVerifiedPriceMap();

  const results: DesignEvalCaseResult[] = [];
  for (const testCase of file.cases) {
    results.push(await runDesignEvalCase(testCase, { entries, priceByCanonicalId: prices }));
  }
  const summary = summarizeEvalResults(results);
  mkdirSync(resolve("data/evals"), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dataSource: "fixture（supported 目录 + 已审核价格证据；脱敏目标）",
        summary,
        cases: results,
      },
      null,
      2,
    ),
  );
  console.log(`评测完成：${summary.passed}/${summary.total} 通过；unsupported claim rate = ${summary.unsupportedClaimRate}`);
  console.log(`报告已写入 ${reportPath}`);
  if (summary.failed.length > 0 || summary.unsupportedClaimRate > 0) {
    process.exit(1);
  }
}

void main();
