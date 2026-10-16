import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixtureCatalogEntries, fixtureVerifiedPriceMap } from "../src/infra/catalog-import/fixture";
import { buildCandidatePool, type CandidateSummary, type RankedCandidate } from "../src/domain/catalog/ranking";
import { generateDesignProposal } from "../src/domain/design/proposal";
import { proposeSwapWithLlm, SWAP_PROMPT_VERSION } from "../src/application/design/intent-llm";
import { createAgentTools } from "../src/application/agent/tools/registry";
import { resolveLlmConfigFromEnv } from "../src/infra/llm/client";
import { parseDesignIntent } from "../src/domain/design/intent";

/**
 * 换件通道思考 A/B（Phase 5：最后一类未做数据决策的思考调用）。
 *
 * 场景：4070S（12VHPWR）+ 鑫铜 650W（无 16pin）→ 供电接口 finding；
 * 正确换件 = TUF 850（有 16pin），干扰项 = 海韵 750（无 16pin）。
 * 指标：提案正确率（换到能消除 finding 的候选）、延迟；思考开 vs 关各跑一遍。
 *
 * 默认离线；--live 跑真实模型（RIGMATE_LLM_API_KEY）。
 */

const args = process.argv.slice(2);
const live = args.includes("--live");

if (!live) {
  console.log("离线模式：不发网络请求。真实模型评测请 `npm run evals:swap -- --live`。");
  process.exit(0);
}

const config = resolveLlmConfigFromEnv();
if (!config) {
  throw new Error("--live 需要 RIGMATE_LLM_API_KEY。");
}
void readFileSync;
void resolve;
const swapConfig = config;

const intent = parseDesignIntent({ rawInput: "1.5 万预算打 3A" });
const entries = fixtureCatalogEntries() as RankedCandidate[];
const prices = fixtureVerifiedPriceMap();
const { pool } = buildCandidatePool(entries, intent, ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"], prices);

const generated = generateDesignProposal({
  requestId: "00000000-0000-4000-8000-00000000f001",
  intent,
  candidates: pool,
});
if (generated.status !== "ok") {
  console.error("fixture 组合生成失败");
  process.exit(1);
}

// 把电源强制换成无 16pin 的鑫铜 650W，制造供电接口 finding
const items = generated.proposal.items.map((item) =>
  item.category === "psu" ? { ...item, catalogId: "psu-sx-650", label: "振华 鑫铜 650W（80+ 铜牌）" } : item,
);
const tools = createAgentTools({
  entries: (fixtureCatalogEntries() as unknown as RankedCandidate[]),
  priceByCanonicalId: prices,
});
const findings = tools.runCompatibilityCheck({
  items: items.map((item) => ({ category: item.category, label: item.label, spec: item.spec })),
});
const actionable = findings.filter((finding) => finding.status === "block" || finding.status === "warn");
console.log(`构造冲突：${actionable.length} 条可处理发现（${actionable.map((finding) => finding.ruleId).join("、") || "无"}）`);
if (actionable.length === 0) {
  console.error("未构造出冲突，检查 fixture 组合");
  process.exit(1);
}

const currentPsu = items.find((item) => item.category === "psu")!;
const psuCandidates: CandidateSummary[] = pool.filter(
  (candidate) => candidate.category === "psu" && candidate.canonicalId !== "psu-sx-650",
);

async function runConfig(label: string, thinking: "enabled" | "disabled") {
  const startedAt = Date.now();
  const result = await proposeSwapWithLlm({
    findings: actionable.map((finding) => ({
      ruleId: finding.ruleId,
      status: finding.status,
      conclusion: finding.conclusion,
      suggestedAction: finding.suggestedAction,
    })),
    currentItem: { category: "psu", label: currentPsu.label, spec: currentPsu.spec },
    candidates: psuCandidates,
    config: swapConfig,
    thinking,
    maxTokens: 1200,
  });
  const latencyMs = Date.now() - startedAt;
  if (!result.ok) {
    console.log(`[${label}] FAIL ${latencyMs}ms | ${result.reason}`);
    return;
  }
  if (result.data === null) {
    console.log(`[${label}] 无提案 ${latencyMs}ms（模型认为池内没有更优）`);
    return;
  }
  // 采纳验证：换上提案后，供电 finding 是否消失
  const swappedItems = items.map((item) =>
    item.category === "psu" ? { ...item, catalogId: result.data!.catalogId, spec: psuCandidates.find((c) => c.canonicalId === result.data!.catalogId)?.spec ?? item.spec } : item,
  );
  const after = tools.runCompatibilityCheck({
    items: swappedItems.map((item) => ({ category: item.category, label: item.label, spec: item.spec })),
  });
  const beforeCount = actionable.length;
  const afterCount = after.filter((finding) => finding.status === "block" || finding.status === "warn").length;
  console.log(
    `[${label}] ${latencyMs}ms | 提案 → ${result.data.catalogId}（${result.data.reason.slice(0, 30)}）| 阻断/警告 ${beforeCount}→${afterCount} ${afterCount < beforeCount ? "✓ 改善" : "✗ 未改善"}`,
  );
}

console.log(`换件 A/B（promptVersion ${SWAP_PROMPT_VERSION}，候选 ${psuCandidates.length} 条）`);
async function main(): Promise<void> {
  await runConfig("思考开", "enabled");
  await runConfig("思考关", "disabled");
}

main();
