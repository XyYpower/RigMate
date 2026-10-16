import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reviseIntentWithLlm } from "../src/application/design/intent-llm";
import { mergeRevisionIntent, INTENT_FIELDS, type IntentField } from "../src/domain/design/revision-merge";
import { resolveLlmConfigFromEnv } from "../src/infra/llm/client";
import type { StructuredIntent } from "../src/contracts/design";

/**
 * 修订字段保持评测（M5，blueprint §9.2 修订字段保持率）。
 *
 * 真实模型出完整意图 → mergeRevisionIntent 合并守卫。指标：
 * - 模型原始漂移率：守卫之前，模型动了多少"指令未触达"的字段（守卫存在的理由）；
 * - 字段保持率：守卫之后，未触达字段与 before 全等的比例（应恒为 1，失守即守卫 bug）；
 * - 触达正确率：期望触达字段出现在 changedFields（期望为空时 = changedFields 应为空）。
 *
 * 默认离线不发请求；--live 跑真实模型（RIGMATE_LLM_API_KEY）。
 */

type RevisionCase = {
  id: string;
  beforeIntent: StructuredIntent;
  instruction: string;
  expectTouched?: IntentField[];
  expectTouchedAny?: IntentField[];
};

type CaseReport = {
  id: string;
  ok: boolean;
  driftFields: string[];
  retained: boolean;
  touchedOk: boolean;
  changedFields: string[];
  rejectedFields: string[];
  latencyMs: number;
  tokens: number;
  note: string;
};

const args = process.argv.slice(2);
const live = args.includes("--live");
const casesPath = resolve("data/evals/revision-cases.json");
const reportPath = resolve("data/evals/revision-report.json");

const cases = (JSON.parse(readFileSync(casesPath, "utf8")) as { cases: RevisionCase[] }).cases;

if (!live) {
  console.log("离线模式：本脚本不发网络请求。真实模型评测请 `npm run evals:revision -- --live`。");
  process.exit(0);
}

const config = resolveLlmConfigFromEnv();
if (!config) {
  console.error("--live 需要 RIGMATE_LLM_API_KEY。");
  process.exit(1);
}

function untouchedEqual(before: StructuredIntent, after: StructuredIntent, untouched: IntentField[]): boolean {
  return untouched.every((field) => JSON.stringify(before[field]) === JSON.stringify(after[field]));
}

const reports: CaseReport[] = [];
for (const testCase of cases) {
  const startedAt = Date.now();
  const result = await reviseIntentWithLlm({
    currentIntent: testCase.beforeIntent,
    instruction: testCase.instruction,
    config,
    maxTokens: 1200,
  });
  const latencyMs = Date.now() - startedAt;
  if (!result.ok) {
    reports.push({
      id: testCase.id,
      ok: false,
      driftFields: [],
      retained: true,
      touchedOk: false,
      changedFields: [],
      rejectedFields: [],
      latencyMs,
      tokens: 0,
      note: `调用失败：${result.reason}`,
    });
    continue;
  }
  const usage = result.usage?.totalTokens ?? 0;
  const merge = mergeRevisionIntent({
    before: testCase.beforeIntent,
    instruction: testCase.instruction,
    modelIntent: result.data,
  });
  const expectedTouched = testCase.expectTouched ?? [];
  const expectedAny = testCase.expectTouchedAny ?? [];
  const untouched = INTENT_FIELDS.filter(
    (field) => !expectedTouched.includes(field) && !expectedAny.includes(field),
  );
  // 模型原始漂移：守卫之前，未触达字段被模型改动
  const driftFields = untouched.filter(
    (field) => JSON.stringify(result.data[field]) !== JSON.stringify(testCase.beforeIntent[field]),
  );
  const retained = untouchedEqual(testCase.beforeIntent, merge.intent, untouched);
  const touchedOk =
    expectedTouched.length > 0
      ? expectedTouched.every((field) => merge.changedFields.includes(field))
      : expectedAny.length > 0
        ? expectedAny.some((field) => merge.changedFields.includes(field))
        : merge.changedFields.length === 0;
  reports.push({
    id: testCase.id,
    ok: true,
    driftFields,
    retained,
    touchedOk,
    changedFields: merge.changedFields,
    rejectedFields: merge.rejectedFields,
    latencyMs,
    tokens: usage,
    note: driftFields.length > 0 ? `模型漂移：${driftFields.join("、")}（守卫拦截）` : "",
  });
}

const okReports = reports.filter((report) => report.ok);
const totalUntouched = okReports.reduce(
  (sum, report) => sum + INTENT_FIELDS.length - ((JSON.parse(readFileSync(casesPath, "utf8")) as { cases: RevisionCase[] }).cases.find((c) => c.id === report.id)?.expectTouched?.length ?? 0),
  0,
);
const driftedCount = okReports.reduce((sum, report) => sum + report.driftFields.length, 0);
const retainedCount = okReports.filter((report) => report.retained).length;
const touchedOkCount = okReports.filter((report) => report.touchedOk).length;

console.log(`== 修订字段保持（真实模型，${cases.length} 条，成功 ${okReports.length}）==`);
for (const report of reports) {
  const mark = report.ok && report.retained && report.touchedOk ? "✓" : "✗";
  console.log(
    `${mark} ${report.id.padEnd(26)} changed=[${report.changedFields.join(",")}] rejected=[${report.rejectedFields.join(",")}] ${report.note} ${report.ok ? `${report.latencyMs}ms/${report.tokens}tok` : report.note}`,
  );
}
console.log(
  `\n模型原始漂移率 ${(totalUntouched > 0 ? (driftedCount / totalUntouched) * 100 : 0).toFixed(1)}%（${driftedCount}/${totalUntouched}） ｜ ` +
    `守卫后字段保持率 ${okReports.length > 0 ? ((retainedCount / okReports.length) * 100).toFixed(1) : "n/a"}% ｜ ` +
    `触达正确率 ${okReports.length > 0 ? ((touchedOkCount / okReports.length) * 100).toFixed(1) : "n/a"}% ｜ ` +
    `平均延迟 ${okReports.length > 0 ? Math.round(okReports.reduce((sum, report) => sum + report.latencyMs, 0) / okReports.length) : 0}ms ｜ tokens ${okReports.reduce((sum, report) => sum + report.tokens, 0)}`,
);

writeFileSync(
  reportPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), cases: cases.length, reports, summary: { driftRate: totalUntouched > 0 ? driftedCount / totalUntouched : 0, retained: okReports.length > 0 ? retainedCount / okReports.length : null, touchedOk: okReports.length > 0 ? touchedOkCount / okReports.length : null } }, null, 2)}\n`,
);
console.log(`\n报告已写入 ${reportPath}`);
