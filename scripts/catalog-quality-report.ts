import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { REQUIRED_FIELDS_BY_CATEGORY, auditCatalog, type AuditableCatalogEntry } from "../src/domain/catalog/audit";

/**
 * 目录质量报表 CLI（实施计划 Task 3/Task 6 的命令行层）：只读。
 *
 * 输出：质量状态分布、来源分层、必填字段完整率、字段级证据覆盖、
 * 待审核队列积压与最近导入批次。批次级"新增/更新/拒绝/冲突"计数见
 * importBuildcoresBatch 的返回报告（scripts/import-catalog-to-db.ts --merge-buildcores）。
 */

const dbPath = process.env.RIGMATE_DB_PATH ?? resolve("data/rigmate.db");
const outputPath = process.env.RIGMATE_CATALOG_QUALITY_REPORT_PATH;

const db = new Database(dbPath, { readonly: true });

type ProductRow = { id: string; category: string; name: string; aliases: string; spec: string; source: string; quality_status: string };
const products = db.prepare("select id, category, name, aliases, spec, source, quality_status from canonical_products order by category, name, id").all() as ProductRow[];

const entries: AuditableCatalogEntry[] = products.map((row) => ({
  id: row.id,
  category: row.category as AuditableCatalogEntry["category"],
  name: row.name,
  aliases: JSON.parse(row.aliases) as string[],
  spec: JSON.parse(row.spec) as Record<string, unknown>,
  source: row.source as AuditableCatalogEntry["source"],
}));

const qualityByStatus = products.reduce<Record<string, number>>((acc, row) => {
  const status = row.quality_status || "partial";
  acc[status] = (acc[status] ?? 0) + 1;
  return acc;
}, {});
const qualityBySource = products.reduce<Record<string, number>>((acc, row) => {
  acc[row.source] = (acc[row.source] ?? 0) + 1;
  return acc;
}, {});

const audit = auditCatalog(entries);

const evidenceStats = db
  .prepare(
    `select count(*) as total,
            count(distinct canonical_product_id) as products,
            count(distinct canonical_product_id || '|' || field_path) as productFields,
            sum(case when verified_at is not null then 1 else 0 end) as verified
     from product_field_evidence`,
  )
  .get() as { total: number; products: number; productFields: number; verified: number | null };
const sourceStats = db
  .prepare("select count(*) as total, sum(case when status = 'unreviewed' then 1 else 0 end) as unreviewed from product_sources")
  .get() as { total: number; unreviewed: number | null };
const conflictEvents = db
  .prepare("select count(*) as total from data_quality_events where event_type = 'conflict'")
  .get() as { total: number };

const queueRows = db
  .prepare("select status, queue_type, count(*) as count from pending_catalog_queue group by status, queue_type")
  .all() as Array<{ status: string; queue_type: string; count: number }>;

const importRuns = db
  .prepare("select upstream_commit, imported_at, imported_count, skipped_count, error_count from catalog_import_runs order by imported_at desc limit 5")
  .all() as Array<{ upstream_commit: string; imported_at: string; imported_count: number; skipped_count: number; error_count: number }>;

// 关键决策字段（影响兼容规则）的证据覆盖率：有证据的产品字段数 / 已填的关键字段数
const criticalFields = Object.entries(REQUIRED_FIELDS_BY_CATEGORY).flatMap(([category, fields]) =>
  (entries.filter((entry) => entry.category === category) as AuditableCatalogEntry[]).flatMap((entry) =>
    fields.map((field) => ({ entryId: entry.id, field, filled: entry.spec[field] !== undefined && entry.spec[field] !== null })),
  ),
);
const criticalFilled = criticalFields.filter((item) => item.filled).length;

const report = {
  generatedAt: new Date().toISOString(),
  dbPath,
  products: { total: products.length, byQualityStatus: qualityByStatus, bySource: qualityBySource },
  requiredFieldAudit: audit,
  evidence: {
    totalEvidence: evidenceStats.total,
    verifiedEvidence: evidenceStats.verified ?? 0,
    productsWithEvidence: evidenceStats.products,
    productFieldPairs: evidenceStats.productFields,
    criticalFieldsTotal: criticalFields.length,
    criticalFieldsFilled: criticalFilled,
    /** 证据覆盖率 = 有证据的产品字段对 / 已填关键...此处为全字段口径，仅作基线 */
    evidenceCoverageBaseline: evidenceStats.total,
  },
  sources: { total: sourceStats.total, unreviewed: sourceStats.unreviewed ?? 0 },
  conflicts: { qualityEvents: conflictEvents.total },
  queue: queueRows,
  recentImportRuns: importRuns,
};

if (outputPath) {
  const resolved = resolve(outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, JSON.stringify(report, null, 2), "utf8");
}

console.log(`目录总数：${products.length}`);
console.log("质量状态：", qualityByStatus);
console.log("来源分布：", qualityBySource);
console.log("必填字段完整率：");
for (const [category, value] of Object.entries(audit.byCategory)) {
  const rate = value.total === 0 ? 0 : (value.complete / value.total) * 100;
  console.log(`  ${category}: ${value.complete}/${value.total}（${rate.toFixed(1)}%）`);
}
console.log(
  `字段证据：${evidenceStats.total} 条（已复核 ${evidenceStats.verified ?? 0}），覆盖 ${evidenceStats.products} 个产品 / ${evidenceStats.productFields} 个产品-字段对`,
);
console.log(`关键决策字段已填 ${criticalFilled}/${criticalFields.length}`);
console.log(`来源登记：${sourceStats.total} 行（待复核 ${sourceStats.unreviewed ?? 0}）；冲突事件 ${conflictEvents.total} 次`);
console.log("待审核队列：", queueRows.length > 0 ? queueRows : "空");
if (outputPath) console.log("报告文件：" + resolve(outputPath));
db.close();
