import Database from "better-sqlite3";
import { resolve } from "node:path";
import { REQUIRED_FIELDS_BY_CATEGORY } from "../src/domain/catalog/audit";
import { LATEST_SCHEMA_VERSION } from "../src/infra/db/migrate";

/**
 * 数据发布门禁（实施计划 Task 9）：只读检查当前数据库的不变量，违规即非零退出。
 *
 * 与 typecheck/lint/test 互补（npm run gate:data 会先跑那三样），本脚本检查：
 *   G1 schema 版本与代码一致（防止旧结构数据进入发布）。
 *   G2 不存在"无来源 verified"：quality_status=verified 的产品必须有
 *      ≥1 条已盖章（verified_at 非空）且来源状态为 verified 的字段证据——
 *      没走审核链路的 verified 一律视为违规。
 *   G3 verified 产品的全部必填字段在 spec 里齐全（verified 语义 = 关键字段全核验）。
 *   G4 conflicting / stale 产品有 conflict/deprecated 质量事件留痕（降级必须可追溯）。
 *   G5 批次报告存在：catalog_import_runs 至少 1 条（可回溯导入历史）。
 *   G6 价格与规格隔离：price_evidence 的 canonical_product_id（如填）必须指向存在的产品。
 */

type CheckResult = { id: string; name: string; ok: boolean; detail: string };

const dbPath = process.env.RIGMATE_DB_PATH ?? resolve("data/rigmate.db");
const db = new Database(dbPath, { readonly: true });

const results: CheckResult[] = [];
function check(id: string, name: string, ok: boolean, detail: string): void {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${name}：${detail}`);
}

// G1 schema 版本
const versionRow = db.prepare("SELECT version FROM schema_version WHERE id = 1").get() as { version: number } | undefined;
check(
  "G1",
  "schema 版本",
  versionRow?.version === LATEST_SCHEMA_VERSION,
  `库版本 ${versionRow?.version ?? "(无)"}，代码支持 ${LATEST_SCHEMA_VERSION}`,
);

// G2 无来源 verified
const unbackedVerified = db
  .prepare(
    `SELECT cp.id, cp.name FROM canonical_products cp
     WHERE cp.quality_status = 'verified' AND cp.merged_into IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM product_field_evidence e
         JOIN product_sources s ON s.id = e.source_id
         WHERE e.canonical_product_id = cp.id
           AND e.verified_at IS NOT NULL AND s.status = 'verified'
       )`,
  )
  .all() as Array<{ id: string; name: string }>;
check(
  "G2",
  "无来源 verified",
  unbackedVerified.length === 0,
  unbackedVerified.length === 0
    ? "所有 verified 产品都有已盖章的字段证据"
    : `违规 ${unbackedVerified.length} 条：${unbackedVerified.slice(0, 5).map((row) => row.id).join("、")}${unbackedVerified.length > 5 ? "…" : ""}`,
);

// G3 verified 产品的必填字段齐全
const verifiedRows = db
  .prepare("SELECT id, category, spec FROM canonical_products WHERE quality_status = 'verified' AND merged_into IS NULL")
  .all() as Array<{ id: string; category: string; spec: string }>;
const missingFields: string[] = [];
for (const row of verifiedRows) {
  const required = REQUIRED_FIELDS_BY_CATEGORY[row.category as keyof typeof REQUIRED_FIELDS_BY_CATEGORY] ?? [];
  const spec = JSON.parse(row.spec) as Record<string, unknown>;
  const absent = required.filter((field) => spec[field] === undefined || spec[field] === null);
  if (absent.length > 0) missingFields.push(`${row.id} 缺 ${absent.join("/")}`);
}
check(
  "G3",
  "verified 必填字段齐全",
  missingFields.length === 0,
  missingFields.length === 0
    ? `${verifiedRows.length} 条 verified 产品必填字段完整`
    : missingFields.slice(0, 5).join("；"),
);

// G4 冲突/过期降级有事件留痕
const degradedWithoutEvent = db
  .prepare(
    `SELECT cp.id FROM canonical_products cp
     WHERE cp.quality_status IN ('conflicting', 'stale') AND cp.merged_into IS NULL
       AND (SELECT count(*) FROM data_quality_events qe
            WHERE qe.canonical_product_id = cp.id AND qe.event_type IN ('conflict', 'deprecated')) = 0`,
  )
  .all() as Array<{ id: string }>;
check(
  "G4",
  "冲突/过期降级留痕",
  degradedWithoutEvent.length === 0,
  degradedWithoutEvent.length === 0
    ? "降级产品均有质量事件可追溯"
    : `违规 ${degradedWithoutEvent.length} 条：${degradedWithoutEvent.slice(0, 5).map((row) => row.id).join("、")}`,
);

// G5 批次报告
const importCount = (db.prepare("SELECT count(*) AS c FROM catalog_import_runs").get() as { c: number }).c;
check("G5", "导入批次报告", importCount > 0, `catalog_import_runs 共 ${importCount} 条`);

// G6 价格与规格隔离
const danglingPrices = db
  .prepare(
    `SELECT count(*) AS c FROM price_evidence p
     WHERE p.canonical_product_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM canonical_products cp WHERE cp.id = p.canonical_product_id)`,
  )
  .get() as { c: number };
check(
  "G6",
  "价格 canonicalId 指向存在的产品",
  danglingPrices.c === 0,
  danglingPrices.c === 0 ? "无悬空价格绑定" : `${danglingPrices.c} 条价格证据指向不存在的产品`,
);

db.close();

const failed = results.filter((result) => !result.ok);
console.log("");
console.log(failed.length === 0 ? `数据门禁通过（${results.length} 项检查）。` : `数据门禁未通过：${failed.map((result) => result.id).join("、")} 失败。`);
process.exit(failed.length === 0 ? 0 : 1);
