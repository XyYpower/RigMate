import { createHash } from "node:crypto";
import { listCatalogQualityRows } from "../src/infra/db/repositories/catalog-repository";
import { getCatalogSnapshot } from "../src/infra/db/repositories/catalog-repository";
import { listProductSources, addProductSource, addFieldEvidence } from "../src/infra/db/repositories/evidence-repository";
import { publishProduct } from "../src/application/catalog-review/service";
import { requiredFieldsOf } from "../src/domain/catalog/quality";
import type { BuildItemCategory } from "../src/domain/build/types";

/**
 * 八类最小质量候选池补齐（next-phase 计划 Task E，用户 2026-10-10 指示）。
 *
 * 原理（诚实路径，不碰 quality_status 直写）：
 *   目录条目的导入规格本身有出处——BuildCores OpenDB 是 S3（专业第三方结构化聚合，
 *   ODC-By 1.0），种子/人工目录是 S4（人工整理）。把每类"必填字段齐全"的条目
 *   走正式证据链：登记来源 → 逐必填字段落证据 → publishProduct 重算发布。
 *   S3/S4 + 未人工复核 → 字段 supported → 产品 supported，**永不 verified**。
 * 幂等：已有来源登记或已 verified/supported 的条目跳过。
 *
 * 用法：
 *   npx tsx scripts/promote-minimal-pool.ts --reviewer <署名> [--dry-run] [--limit-per-category 60]
 */

const args = process.argv.slice(2);
const reviewerArg = args.indexOf("--reviewer");
const reviewer = reviewerArg >= 0 ? args[reviewerArg + 1]?.trim() : undefined;
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit-per-category");
const limitPerCategory = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 60;

if (!reviewer) {
  console.error("必须提供 --reviewer <署名>（写操作强制人工署名）。");
  process.exit(1);
}

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

const rows = listCatalogQualityRows();
const report: Array<{ id: string; category: string; source: string; status: string }> = [];
const errors: string[] = [];

for (const category of CATEGORIES) {
  const required = requiredFieldsOf(category);
  let taken = 0;
  // seed/manual 优先（人工整理优先于批量聚合，与导入 first-wins 同序），再按 id 稳定排序取配额
  const candidates = rows
    .filter((row) => row.category === category && row.qualityStatus === "partial")
    .filter((row) => required.every((field) => row.spec[field] !== undefined && row.spec[field] !== null))
    .sort((a, b) => {
      const sourceRank = (source: string) => (source === "seed" || source === "manual" ? 0 : 1);
      return sourceRank(a.source) - sourceRank(b.source) || a.id.localeCompare(b.id);
    });

  for (const row of candidates) {
    const isCurated = row.source === "seed" || row.source === "manual";
    const quota = limitPerCategory ?? BUILDCORES_QUOTA[category];
    if (!isCurated && taken >= quota) break;

    const snapshot = getCatalogSnapshot(row.id);
    if (!snapshot || snapshot.mergedInto) continue;
    if (listProductSources(row.id).length > 0) continue; // 幂等：已入链

    const sourceType = isCurated ? ("manual" as const) : ("buildcores" as const);
    const tier = isCurated ? ("S4" as const) : ("S3" as const);
    const sourceTitle = isCurated ? "人工/种子目录整理（M17/M20 批次）" : "BuildCores OpenDB 结构化聚合";
    // sourceUrl 必须是合法 URL：curated 条目指向仓库（人工目录与其出处文档都在仓库内）
    const sourceUrl = isCurated
      ? "https://github.com/XyYpower/RigMate"
      : "https://github.com/buildcores/buildcores-open-db";
    const license = isCurated ? null : "ODC-By 1.0";
    const contentHash = createHash("sha256").update(JSON.stringify(snapshot.spec)).digest("hex");

    if (dryRun) {
      report.push({ id: row.id, category, source: row.source, status: "dry-run" });
      taken += 1;
      continue;
    }

    try {
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
      for (const field of required) {
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
        reviewer,
        note: `最小候选池批量入链（${sourceTitle}，${tier} 未复核 → supported；promote-minimal-pool）`,
      });
      report.push({ id: row.id, category, source: row.source, status: published.productStatus });
      taken += 1;
    } catch (error) {
      errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
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
