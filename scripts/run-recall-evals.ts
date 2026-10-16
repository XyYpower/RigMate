import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildCategoryCandidates, type RankedCandidate } from "../src/domain/catalog/ranking";
import { loadSourcedCatalog } from "../src/infra/catalog-import/load";
import { normalizeModelText } from "../src/domain/catalog/normalize";

/**
 * 离线召回评测（M2，blueprint §6/§9：先离线验证，再接 Agent——分桶召回已接线，
 * 本脚本负责持续测量）。默认离线可重放：真实目录 + 固定样本，绝不发网络请求。
 *
 * 指标：
 * - Recall@6 / Recall@20：期望型号出现在候选池前 K 的比例（按名称/别名/中文名子串匹配）；
 * - MRR：期望型号首次命中位置倒数的均值（20 内未命中记 0）；
 * - 空结果准确率：用户点了目录里没有的型号时，exact/alias 桶必须为空（不得冒充命中）。
 */

type RecallCase = {
  id: string;
  query: string;
  category: string;
  expectNameContains?: string;
  expectNoNamedHit?: boolean;
};

type CaseReport = {
  id: string;
  pass: boolean;
  hitRank: number;
  bucket: string | null;
  detail: string;
};

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const casesPath = resolve("data/evals/recall-cases.json");
const reportPath = resolve("data/evals/recall-report.json");

const cases = (JSON.parse(readFileSync(casesPath, "utf8")) as { cases: RecallCase[] }).cases;
const { entries, dbBacked } = loadSourcedCatalog();
const emptyIntent = {
  budgetCents: null,
  useCases: [],
  appearance: [],
  existingParts: [],
  constraints: [],
  region: "中国大陆",
};

/** 候选摘要不带 aliases：按 canonicalId 回查原始条目拼身份文本（name + nameZh + aliases） */
const entryById = new Map(entries.map((entry) => [entry.id, entry]));
const identityOf = (candidate: { canonicalId: string }) => {
  const entry = entryById.get(candidate.canonicalId);
  const raw = entry as { name?: string; nameZh?: string | null; aliases?: string[] } | undefined;
  return [raw?.name ?? "", raw?.nameZh ?? "", ...(raw?.aliases ?? [])]
    .filter(Boolean)
    .map((text) => normalizeModelText(text))
    .join("\u0001");
};

function runCase(caseItem: RecallCase): CaseReport {
  const { candidates } = buildCategoryCandidates({
    entries: entries as RankedCandidate[],
    category: caseItem.category as Parameters<typeof buildCategoryCandidates>[0]["category"],
    intent: emptyIntent,
    queries: [caseItem.query],
  });

  if (caseItem.expectNoNamedHit) {
    const named = candidates.filter((candidate) => candidate.bucket === "exact" || candidate.bucket === "alias");
    return {
      id: caseItem.id,
      pass: named.length === 0,
      hitRank: 0,
      bucket: null,
      detail: named.length === 0 ? "未冒充命中 ✓" : `误命中：${named.map((candidate) => candidate.canonicalId).join("、")}`,
    };
  }

  const needle = normalizeModelText(caseItem.expectNameContains ?? "");
  let hitRank = 0;
  let bucket: string | null = null;
  for (const [index, candidate] of candidates.entries()) {
    if (identityOf(candidate).includes(needle)) {
      hitRank = index + 1;
      bucket = candidate.bucket ?? null;
      break;
    }
  }
  return {
    id: caseItem.id,
    pass: hitRank > 0,
    hitRank,
    bucket,
    detail: hitRank > 0 ? `第 ${hitRank} 位命中（${bucket}）` : "前 20 未命中",
  };
}

const reports = cases.map(runCase);
const hitCases = cases.filter((caseItem) => !caseItem.expectNoNamedHit);
const emptyCases = cases.filter((caseItem) => caseItem.expectNoNamedHit);
const reportById = new Map(reports.map((report) => [report.id, report]));

const recallAt = (k: number) => {
  const hits = hitCases.filter((caseItem) => {
    const report = reportById.get(caseItem.id);
    return report?.pass && report.hitRank <= k;
  }).length;
  return hitCases.length > 0 ? hits / hitCases.length : 1;
};
const mrr =
  hitCases.reduce((sum, caseItem) => {
    const report = reportById.get(caseItem.id);
    return sum + (report?.pass ? 1 / report.hitRank : 0);
  }, 0) / Math.max(1, hitCases.length);
const emptyAccuracy =
  emptyCases.length > 0
    ? emptyCases.filter((caseItem) => reportById.get(caseItem.id)?.pass).length / emptyCases.length
    : 1;

console.log(`目录：${entries.length} 条（dbBacked=${dbBacked}）｜样本：${cases.length} 条（命中 ${hitCases.length} / 空结果 ${emptyCases.length}）\n`);
for (const report of reports) {
  const mark = report.pass ? "✓" : "✗";
  console.log(`${mark} ${report.id.padEnd(24)} ${report.detail}`);
}
console.log(`\nRecall@6 = ${(recallAt(6) * 100).toFixed(1)}% ｜ Recall@20 = ${(recallAt(20) * 100).toFixed(1)}% ｜ MRR = ${mrr.toFixed(3)} ｜ 空结果准确率 = ${(emptyAccuracy * 100).toFixed(1)}%`);

if (jsonOut) {
  mkdirSync(resolve("data/evals"), { recursive: true });
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        catalogSize: entries.length,
        caseCount: cases.length,
        metrics: { recallAt6: recallAt(6), recallAt20: recallAt(20), mrr, emptyAccuracy },
        cases: reports,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n报告已写入 ${reportPath}`);
}
