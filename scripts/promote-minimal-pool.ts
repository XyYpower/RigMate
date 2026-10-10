import { createHash } from "node:crypto";
import { listCatalogQualityRows, getCatalogSnapshot, loadCatalogEntries } from "../src/infra/db/repositories/catalog-repository";
import { listProductSources, addProductSource, addFieldEvidence } from "../src/infra/db/repositories/evidence-repository";
import { publishProduct } from "../src/application/catalog-review/service";
import { requiredFieldsOf } from "../src/domain/catalog/quality";
import type { BuildItemCategory } from "../src/domain/build/types";

/**
 * 八类最小质量候选池补齐（next-phase 计划 Task E）。
 *
 * 原理（诚实路径，不碰 quality_status 直写）：
 *   目录条目的导入规格本身有出处——BuildCores OpenDB 是 S3（专业第三方结构化聚合，
 *   ODC-By 1.0），种子/人工目录是 S4（人工整理）。把每类"必填字段齐全"的条目
 *   走正式证据链：登记来源 → 逐必填字段落证据 → publishProduct 重算发布。
 *   S3/S4 + 未人工复核 → 字段 supported → 产品 supported，**永不 verified**。
 *
 * 顺序：人工/种子优先 → 最新入库优先（上游刷新的新代际 25-26 年硬件先补）。
 * 幂等：已有来源登记或已 verified/supported 的条目跳过。
 *
 * 用法：
 *   npx tsx scripts/promote-minimal-pool.ts --reviewer <署名> [--dry-run]
 *        [--limit-per-category 60] [--must-include "9950X3D,RTX 5090,…"]
 *   --must-include：命中关键词的合格条目不受配额限制（确定性收录指定代际，每关键词上限 40）。
 */

const args = process.argv.slice(2);
const reviewerArg = args.indexOf("--reviewer");
const reviewer = reviewerArg >= 0 ? args[reviewerArg + 1]?.trim() : undefined;
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit-per-category");
const limitPerCategory = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 60;
const mustIncludeIndex = args.indexOf("--must-include");
const mustIncludeKeywords = mustIncludeIndex >= 0
  ? (args[mustIncludeIndex + 1] ?? "").split(",").map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)
  : [];
const MUST_INCLUDE_CAP = 40;

if (!reviewer) {
  console.error("必须提供 --reviewer <署名>（写操作强制人工署名）。");
  process.exit(1);
}
const reviewerName: string = reviewer;

const CATEGORIES: BuildItemCategory[] = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"];

/** 每类 BuildCores 配额（seed/manual 全量收录，不受配额限制） */
const BUILDCORES_QUOTA: Record<BuildItemCategory, number> = {
  cpu: 40,
  motherboard: 10,
  gpu: 60,
  ram: 40,
  storage: 40,
  psu: 60,
  cooler: 60,
  case: 60,
};

const qualityRows = listCatalogQualityRows();
const report: Array<{ id: string; category: string; source: string; status: string }> = [];
const errors: string[] = [];

function isEligible(row: { qualityStatus: string; spec: Record<string, unknown> }, category: BuildItemCategory): boolean {
  if (row.qualityStatus !== "partial") return false;
  return requiredFieldsOf(category).every((field) => row.spec[field] !== undefined && row.spec[field] !== null);
}

function promoteOne(
  row: { id: string; category: BuildItemCategory; source: string },
  isCurated: boolean,
): { status: string } | null {
  const snapshot = getCatalogSnapshot(row.id);
  if (!snapshot || snapshot.mergedInto) return null;
  if (listProductSources(row.id).length > 0) return null; // 幂等：已入链

  const sourceType = isCurated ? ("manual" as const) : ("buildcores" as const);
  const tier = isCurated ? ("S4" as const) : ("S3" as const);
  const sourceTitle = isCurated ? "人工/种子目录整理（M17/M20 批次）" : "BuildCores OpenDB 结构化聚合";
  const sourceUrl = isCurated
    ? "https://github.com/XyYpower/RigMate"
    : "https://github.com/buildcores/buildcores-open-db";
  const license = isCurated ? null : "ODC-By 1.0";
  const contentHash = createHash("sha256").update(JSON.stringify(snapshot.spec)).digest("hex");

  const source = addProductSource({
    canonicalProductId: row.id,
    sourceType,
    tier,
    sourceUrl,
    sourceTitle,
    sourceVersion: snapshot.sourceVersion,
    license,
    capturedAt: new Date().toISOString(),
    contentHash,
    status: "unreviewed",
    reviewerNote: null,
  });
  for (const field of requiredFieldsOf(row.category)) {
    addFieldEvidence({
      canonicalProductId: row.id,
      fieldPath: `spec.${field}`,
      sourceId: source.id,
      value: snapshot.spec[field],
      excerpt: `${sourceTitle} 导入规格快照`,
      identityMatch: "unmatched",
      confidence: "medium",
      verifiedAt: null,
      verifiedBy: null,
      supersedesId: null,
    });
  }
  const published = publishProduct({
    canonicalProductId: row.id,
    reviewer: reviewerName,
    note: `最小候选池批量入链（${sourceTitle}，${tier} 未复核 → supported；promote-minimal-pool）`,
  });
  return { status: published.productStatus };
}

// ---- 第一遍：配额补池（人工/种子优先，最新入库优先） ----
for (const category of CATEGORIES) {
  const required = requiredFieldsOf(category);
  let taken = 0;
  const candidates = qualityRows
    .filter((row) => row.category === category && isEligible(row, category))
    .sort((a, b) => {
      const sourceRank = (source: string) => (source === "seed" || source === "manual" ? 0 : 1);
      // 最新入库优先：上游刷新带来的新代际产品先补进候选池
      return sourceRank(a.source) - sourceRank(b.source) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    });

  for (const row of candidates) {
    const isCurated = row.source === "seed" || row.source === "manual";
    const quota = limitPerCategory ?? BUILDCORES_QUOTA[category];
    if (!isCurated && taken >= quota) break;
    if (dryRun) {
      report.push({ id: row.id, category, source: row.source, status: "dry-run" });
      taken += 1;
      continue;
    }
    try {
      const result = promoteOne(row, isCurated);
      if (result) {
        report.push({ id: row.id, category, source: row.source, status: result.status });
        taken += 1;
      }
    } catch (error) {
      errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// ---- 第二遍：指定代际必收（关键词命中 name，不受配额限制，每关键词上限 40） ----
if (mustIncludeKeywords.length > 0 && !dryRun) {
  const entries = loadCatalogEntries();
  for (const category of CATEGORIES) {
    const required = requiredFieldsOf(category);
    const records = entries.filter((entry) => entry.category === category);
    for (const keyword of mustIncludeKeywords) {
      let keywordTaken = 0;
      const matched = records
        .filter(
          (record) =>
            record.qualityStatus === "partial" &&
            record.name.toLowerCase().includes(keyword) &&
            required.every((field) => record.spec[field] !== undefined && record.spec[field] !== null),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const record of matched) {
        if (keywordTaken >= MUST_INCLUDE_CAP) break;
        if (listProductSources(record.id).length > 0) continue;
        try {
          const result = promoteOne({ id: record.id, category, source: "buildcores" }, false);
          if (result) {
            report.push({ id: record.id, category, source: "must-include", status: result.status });
            keywordTaken += 1;
          }
        } catch (error) {
          errors.push(`${record.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
}

const byCategory: Record<string, number> = {};
for (const entry of report) byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
console.log(`处理 ${report.length} 条${dryRun ? "（dry-run）" : ""}：`, byCategory);
if (errors.length > 0) {
  console.error(`失败 ${errors.length} 条：`);
  for (const message of errors.slice(0, 10)) console.error(" -", message);
}
console.log(`reviewer: ${reviewer}${dryRun ? "（未实际写入）" : ""}`);
process.exit(errors.length > 0 ? 1 : 0);
