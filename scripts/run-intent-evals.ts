import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDesignIntent, intentNeedsInput } from "../src/domain/design/intent";
import { parseIntentWithLlm } from "../src/application/design/intent-llm";
import { resolveLlmConfigFromEnv } from "../src/infra/llm/client";

/**
 * 意图理解评测（M5，blueprint §9.2 理解指标）。
 *
 * 默认离线：只跑规则路径（生产降级通道）建立基线；
 * --live 加跑真实模型路径（RIGMATE_LLM_API_KEY）；--thinking-disabled 让模型路径关思考对照。
 *
 * 指标：
 * - 预算准确率：期望 cents 全等（null = 不应识别出预算）；
 * - 槽位 F1：useCases ∪ appearance，经同义词归一 + 双向包含容忍（"3A 游戏"≈"游戏"）；
 * - 追问正确率：缺少关键槽位时应追问（LLM 看 followupQuestion，规则看 intentNeedsInput）；
 * - 拒答正确率（仅模型路径）：域外请求应空字段 + 引导回装机；
 * - 延迟 / schema 失败 / token 用量。
 */

type IntentCase = {
  id: string;
  goal: string;
  expect: {
    budgetCents: number | null;
    useCases: string[];
    appearance: string[];
    existingPartsContains?: string[];
    expectFollowup?: boolean;
    expectRefusal?: boolean;
  };
};

const args = process.argv.slice(2);
const live = args.includes("--live");
const thinkingDisabled = args.includes("--thinking-disabled");
const jsonOut = args.includes("--json");
const casesPath = resolve("data/evals/intent-cases.json");
const reportPath = resolve("data/evals/intent-report.json");

const cases = (JSON.parse(readFileSync(casesPath, "utf8")) as { cases: IntentCase[] }).cases;

/** 同义词归一：规则标签与模型措辞对齐（静音≈低噪音） */
const SYNONYMS: Record<string, string> = { 静音: "低噪音", 安静: "低噪音", 打游戏: "游戏", 看视频: "视频剪辑", 剪视频: "视频剪辑" };
const normalizeSlot = (label: string): string => {
  const cleaned = label.trim().toLowerCase();
  return SYNONYMS[cleaned] ?? cleaned;
};

/** 双向包含容忍的槽位集合 F1 */
function slotF1(expected: string[], actual: string[]): number {
  const expectedNorm = expected.map(normalizeSlot);
  const actualNorm = actual.map(normalizeSlot);
  if (expectedNorm.length === 0 && actualNorm.length === 0) return 1;
  let hits = 0;
  for (const actual of actualNorm) {
    if (expectedNorm.some((expected) => expected.includes(actual) || actual.includes(expected))) hits += 1;
  }
  const precision = actualNorm.length > 0 ? hits / actualNorm.length : 0;
  const recall = expectedNorm.length > 0 ? hits / expectedNorm.length : 0;
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

type PathReport = {
  path: string;
  thinking: string;
  budgetAccuracy: number;
  slotF1: number;
  followupAccuracy: number;
  refusalAccuracy: number | null;
  schemaFailures: number;
  errors: number;
  avgLatencyMs: number | null;
  totalTokens: number;
  cases: Array<{ id: string; budgetOk: boolean; slotF1: number; followupOk: boolean; note: string }>;
};

function emptyReport(path: string, thinking: string): PathReport {
  return { path, thinking, budgetAccuracy: 0, slotF1: 0, followupAccuracy: 0, refusalAccuracy: null, schemaFailures: 0, errors: 0, avgLatencyMs: null, totalTokens: 0, cases: [] };
}

function finalize(report: PathReport, count: number, latencySum: number): PathReport {
  report.budgetAccuracy = count > 0 ? report.cases.filter((c) => c.budgetOk).length / count : 0;
  report.slotF1 = count > 0 ? report.cases.reduce((sum, c) => sum + c.slotF1, 0) / count : 0;
  report.followupAccuracy = count > 0 ? report.cases.filter((c) => c.followupOk).length / count : 0;
  report.avgLatencyMs = latencySum > 0 ? Math.round(latencySum / count) : null;
  return report;
}

// ---- 规则路径（始终运行：生产降级通道的基线） ----
const rulesReport = emptyReport("rules", "n/a");
let rulesLatency = 0;
for (const testCase of cases) {
  const startedAt = Date.now();
  const intent = parseDesignIntent({ rawInput: testCase.goal });
  rulesLatency += Date.now() - startedAt;
  const hasQuestion = intentNeedsInput(intent);
  const budgetOk = intent.budgetCents === testCase.expect.budgetCents;
  const f1 = slotF1([...testCase.expect.useCases, ...testCase.expect.appearance], [...intent.useCases, ...intent.appearance]);
  const followupOk = testCase.expect.expectFollowup || testCase.expect.expectRefusal ? hasQuestion : !hasQuestion;
  const existingOk = (testCase.expect.existingPartsContains ?? []).every((needle) =>
    intent.existingParts.some((part) => part.includes(needle)),
  );
  rulesReport.cases.push({
    id: testCase.id,
    budgetOk,
    slotF1: f1,
    followupOk,
    note: existingOk ? "" : `已有件缺识别：期望含 ${(testCase.expect.existingPartsContains ?? []).join("、")}`,
  });
}
finalize(rulesReport, cases.length, rulesLatency);

async function main(): Promise<void> {
// ---- 模型路径（--live） ----
let llmReport: PathReport | null = null;
if (live) {
  const config = resolveLlmConfigFromEnv();
  if (!config) {
    console.error("--live 需要 RIGMATE_LLM_API_KEY。");
    process.exit(1);
  }
  llmReport = emptyReport("llm", thinkingDisabled ? "disabled" : "enabled(产线默认)");
  let latencySum = 0;
  for (const testCase of cases) {
    const startedAt = Date.now();
    const result = await parseIntentWithLlm({
      rawInput: testCase.goal,
      explicitBudgetYuan: null,
      config,
      ...(thinkingDisabled ? { thinking: "disabled" as const } : {}),
      maxTokens: 1500,
    });
    latencySum += Date.now() - startedAt;
    if (!result.ok) {
      llmReport.errors += 1;
      if (result.reason.includes("格式") || result.reason.includes("解析")) llmReport.schemaFailures += 1;
      llmReport.cases.push({ id: testCase.id, budgetOk: false, slotF1: 0, followupOk: false, note: `失败：${result.reason}` });
      continue;
    }
    if (result.usage) llmReport.totalTokens += result.usage.totalTokens;
    const intent = result.data;
    const budgetOk = intent.budgetCents === testCase.expect.budgetCents;
    const f1 = slotF1([...testCase.expect.useCases, ...testCase.expect.appearance], [...intent.useCases, ...intent.appearance]);
    const hasQuestion = Boolean(result.followupQuestion);
    let followupOk: boolean;
    let note = "";
    if (testCase.expect.expectRefusal) {
      const refused =
        hasQuestion &&
        intent.budgetCents === null &&
        intent.useCases.length === 0 &&
        intent.appearance.length === 0 &&
        (result.followupQuestion?.includes("装机") ?? false);
      followupOk = refused;
      if (!refused) note = "未正确拒答域外请求";
    } else {
      followupOk = (testCase.expect.expectFollowup ?? false) === hasQuestion;
    }
    const existingOk = (testCase.expect.existingPartsContains ?? []).every((needle) =>
      intent.existingParts.some((part) => part.includes(needle)),
    );
    if (!existingOk) note += ` 已有件缺识别`;
    llmReport.cases.push({ id: testCase.id, budgetOk, slotF1: f1, followupOk, note: note.trim() });
  }
  finalize(llmReport, cases.length, latencySum);
}

const print = (report: PathReport) => {
  console.log(`\n== ${report.path}（thinking: ${report.thinking}）==`);
  for (const item of report.cases) {
    const mark = item.budgetOk && item.followupOk && item.slotF1 >= 0.99 ? "✓" : item.budgetOk && item.slotF1 > 0 ? "~" : "✗";
    console.log(`${mark} ${item.id.padEnd(30)} F1=${item.slotF1.toFixed(2)} ${item.note}`);
  }
  console.log(
    `预算准确率 ${(report.budgetAccuracy * 100).toFixed(1)}% ｜ 槽位 F1 ${(report.slotF1 * 100).toFixed(1)}% ｜ 追问正确率 ${(report.followupAccuracy * 100).toFixed(1)}%` +
      (report.refusalAccuracy !== null ? ` ｜ 拒答正确率 ${(report.refusalAccuracy * 100).toFixed(1)}%` : "") +
      (report.avgLatencyMs !== null ? ` ｜ 平均延迟 ${report.avgLatencyMs}ms` : "") +
      (report.totalTokens > 0 ? ` ｜ tokens ${report.totalTokens}` : "") +
      (report.schemaFailures + report.errors > 0 ? ` ｜ 失败 ${report.errors}（schema ${report.schemaFailures}）` : ""),
  );
};
print(rulesReport);
if (llmReport) print(llmReport);

if (jsonOut) {
  writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), cases: cases.length, rules: rulesReport, llm: llmReport }, null, 2)}\n`);
  console.log(`\n报告已写入 ${reportPath}`);
}
if (!live) {
  console.log("\n（离线模式：仅规则路径。真实模型评测请 `npm run evals:intent -- --live`，关思考对照加 --thinking-disabled）");
}
}

main();
