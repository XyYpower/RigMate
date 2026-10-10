import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { buildCandidatePool, type RankedCandidate } from "../src/domain/catalog/ranking";
import { selectCatalogCandidatesWithLlm, CATALOG_SELECTION_PROMPT_VERSION } from "../src/application/design/intent-llm";
import { generateDesignProposal } from "../src/domain/design/proposal";
import { parseDesignIntent } from "../src/domain/design/intent";
import { fixtureCatalogEntries, fixtureVerifiedPriceMap } from "../src/infra/catalog-import/fixture";
import { resolveLlmConfigFromEnv } from "../src/infra/llm/client";

/**
 * 真实模型选件评测（next-phase 计划 Task C）。
 *
 * 纪律：
 * - 默认离线：不带 --live 时直接退出，绝不发起网络请求、绝不进入 CI；
 * - --live 需要 RIGMATE_LLM_API_KEY 环境变量（模型端点/型号同环境变量），
 *   key 不落盘、不打印、不写入报告；
 * - 每个用例记录 promptVersion、候选集摘要哈希、守卫结果、最终选择、回退原因与延迟；
 * - 同一 CandidateSet 上对比 模型选择 vs 规则排序 vs 人工期望（组合阻断数与预算占用），
 *   不只比较价格。
 */

const args = process.argv.slice(2);
const live = args.includes("--live");
const casesPath = resolve("data/evals/design-selection-cases.json");
const reportPath = resolve("data/evals/live-report.json");

const CATEGORIES = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"] as const;

type EvalCaseFile = {
  cases: Array<{ id: string; goal: string; model?: unknown }>;
};

type LiveCaseResult = {
  id: string;
  goal: string;
  promptVersion: string;
  poolHash: string;
  poolSize: number;
  rulePick: Partial<Record<string, string>>;
  modelPick: Partial<Record<string, string>> | null;
  guardOk: boolean;
  guardReason?: string;
  fallback: boolean;
  latencyMs: number;
  ruleBlocks: number;
  modelBlocks: number | null;
  ruleOverBudgetCents: number;
  modelOverBudgetCents: number | null;
  error?: string;
};

function compositionScore(proposal: { items: Array<{ priceEstimateLowCents: number | null }>; compatibility: { blockCount: number } }, budgetCents: number | null) {
  const priced = proposal.items.reduce((sum, item) => sum + (item.priceEstimateLowCents ?? 0), 0);
  return {
    blocks: proposal.compatibility.blockCount,
    overBudgetCents: budgetCents !== null && priced > budgetCents ? priced - budgetCents : 0,
  };
}

async function main(): Promise<void> {
  const config = resolveLlmConfigFromEnv();
  if (!live) {
    console.log("离线模式：本脚本默认不发任何网络请求。对真实模型评测请显式运行 `npm run evals:live -- --live`（需 RIGMATE_LLM_API_KEY）。");
    return;
  }
  if (!config) {
    console.error("--live 需要 RIGMATE_LLM_API_KEY（可选 RIGMATE_LLM_BASE_URL / RIGMATE_LLM_MODEL / RIGMATE_LLM_TIMEOUT_MS）。");
    process.exit(1);
  }

  const file = JSON.parse(readFileSync(casesPath, "utf8")) as EvalCaseFile;
  // live 只跑纯目标用例（带受控 model 输出的是守卫用例，守卫已在离线评测覆盖）
  const liveCases = file.cases.filter((testCase) => !testCase.model);
  const entries = fixtureCatalogEntries().filter((entry) => entry.qualityStatus !== "partial") as RankedCandidate[];
  const prices = fixtureVerifiedPriceMap();

  const results: LiveCaseResult[] = [];
  for (const testCase of liveCases) {
    const intent = parseDesignIntent({ rawInput: testCase.goal });
    const { pool } = buildCandidatePool(entries, intent, [...CATEGORIES], prices);
    const poolHash = createHash("sha256").update(JSON.stringify(pool.map((candidate) => candidate.canonicalId))).digest("hex").slice(0, 16);
    const rulePick: Partial<Record<string, string>> = {};
    for (const candidate of pool) rulePick[candidate.category] ??= candidate.canonicalId;

    const startedAt = Date.now();
    const selection = await selectCatalogCandidatesWithLlm({ intent, candidates: pool, config });
    const latencyMs = Date.now() - startedAt;

    const result: LiveCaseResult = {
      id: testCase.id,
      goal: testCase.goal,
      promptVersion: CATALOG_SELECTION_PROMPT_VERSION,
      poolHash,
      poolSize: pool.length,
      rulePick,
      modelPick: selection.ok ? selection.data.selectedIds : null,
      guardOk: selection.ok,
      guardReason: selection.ok ? undefined : selection.reason,
      fallback: !selection.ok,
      latencyMs,
      ruleBlocks: 0,
      modelBlocks: null,
      ruleOverBudgetCents: 0,
      modelOverBudgetCents: null,
    };

    // 规则组合基线
    const ruleGenerated = generateDesignProposal({ requestId: "00000000-0000-4000-8000-00000000e101", intent, candidates: pool });
    if (ruleGenerated.status === "ok") {
      const score = compositionScore(ruleGenerated.proposal, intent.budgetCents);
      result.ruleBlocks = score.blocks;
      result.ruleOverBudgetCents = score.overBudgetCents;
    }

    // 模型组合（守卫通过才生成；失败即回退规则，如实记录）
    if (selection.ok && Object.keys(selection.data.selectedIds).length > 0) {
      const modelGenerated = generateDesignProposal({
        requestId: "00000000-0000-4000-8000-00000000e102",
        intent,
        candidates: pool,
        preferredIds: selection.data.selectedIds,
      });
      if (modelGenerated.status === "ok") {
        const score = compositionScore(modelGenerated.proposal, intent.budgetCents);
        result.modelBlocks = score.blocks;
        result.modelOverBudgetCents = score.overBudgetCents;
      }
    }
    results.push(result);
    console.log(`${testCase.id}: guard=${selection.ok} latency=${latencyMs}ms ruleBlocks=${result.ruleBlocks} modelBlocks=${result.modelBlocks ?? "-"}`);
  }

  const comparable = results.filter((result) => result.modelPick !== null);
  const better = comparable.filter(
    (result) =>
      result.modelBlocks !== null &&
      (result.modelBlocks < result.ruleBlocks ||
        (result.modelBlocks === result.ruleBlocks && result.modelOverBudgetCents !== null && result.modelOverBudgetCents < result.ruleOverBudgetCents)),
  ).length;
  mkdirSync(resolve("data/evals"), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), model: config?.model, summary: { cases: results.length, comparable: comparable.length, modelBetter: better }, cases: results }, null, 2),
  );
  console.log(`\nlive 评测完成：${results.length} 用例（可比较 ${comparable.length}，模型更优 ${better}）。报告：${reportPath}`);
}

void main();
