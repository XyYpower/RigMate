import { sql } from "drizzle-orm";
import type { RigmateDatabase } from "./client";

/**
 * 版本化迁移（M18）。
 *
 * 纪律：每个 up() 必须**幂等**——版本号在 up() 成功之后才写入 schema_version，
 * 迁移中途崩溃时版本不会前移，下次启动会重跑同一步，因此每一步都要能安全地
 * 在半成品库上重复执行（用 CREATE IF NOT EXISTS / 列存在性检查，禁止破坏性重命名）。
 *
 * 版本 0 = 没有版本表的历史库：所有迁移都是幂等的，从 v1 全部跑一遍即可安全
 * 对齐到最新版（真实旧数据不会被动到，与 M3/M10 时代的幂等迁移行为一致）。
 */

export type Migration = {
  version: number;
  name: string;
  up: (db: RigmateDatabase) => void;
};

export type MigrationRecord = { version: number; name: string };

export type MigrationResult = {
  /** 迁移前的数据库版本（0 = 无版本表的历史库） */
  from: number;
  to: number;
  applied: MigrationRecord[];
  /** true = 数据库版本高于代码支持的版本（代码被回滚）：拒绝迁移，避免写入不认识的 schema */
  refusedDowngrade: boolean;
};

export const LATEST_SCHEMA_VERSION = 11;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "核心表：builds / build_items / check_runs / findings",
    up: (db) => {
      db.run(sql`CREATE TABLE IF NOT EXISTS builds (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        use_case text,
        budget_cents integer,
        status text NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )`);
      db.run(sql`CREATE TABLE IF NOT EXISTS build_items (
        id text PRIMARY KEY NOT NULL,
        build_id text NOT NULL,
        category text NOT NULL,
        label text NOT NULL,
        spec text NOT NULL DEFAULT '{}',
        price_cents integer,
        source text,
        created_at text NOT NULL
      )`);
      db.run(sql`CREATE TABLE IF NOT EXISTS check_runs (
        id text PRIMARY KEY NOT NULL,
        build_id text NOT NULL,
        created_at text NOT NULL,
        status text NOT NULL,
        items_snapshot text NOT NULL DEFAULT '[]'
      )`);
      db.run(sql`CREATE TABLE IF NOT EXISTS findings (
        id text PRIMARY KEY NOT NULL,
        check_run_id text NOT NULL,
        rule_id text NOT NULL,
        status text NOT NULL,
        payload text NOT NULL
      )`);
    },
  },
  {
    version: 2,
    name: "build_items 规格列：spec JSON + price_cents，旧 socket 列并入 spec",
    up: (db) => {
      const columns = db.all<{ name: string }>(sql`PRAGMA table_info(build_items)`);
      const names = columns.map((column) => column.name);

      if (!names.includes("spec")) {
        db.run(sql`ALTER TABLE build_items ADD COLUMN spec text NOT NULL DEFAULT '{}'`);
      }

      if (!names.includes("price_cents")) {
        db.run(sql`ALTER TABLE build_items ADD COLUMN price_cents integer`);
      }

      if (names.includes("socket")) {
        const legacyRows = db.all<{ id: string; socket: string | null }>(
          sql`SELECT id, socket FROM build_items WHERE socket IS NOT NULL`,
        );
        for (const row of legacyRows) {
          db.run(
            sql`UPDATE build_items SET spec = ${JSON.stringify({ socket: row.socket })} WHERE id = ${row.id}`,
          );
        }
        db.run(sql`ALTER TABLE build_items DROP COLUMN socket`);
      }
    },
  },
  {
    version: 3,
    name: "check_runs 清单指纹列 items_snapshot",
    up: (db) => {
      const columns = db.all<{ name: string }>(sql`PRAGMA table_info(check_runs)`);
      const names = columns.map((column) => column.name);
      if (!names.includes("items_snapshot")) {
        db.run(sql`ALTER TABLE check_runs ADD COLUMN items_snapshot text NOT NULL DEFAULT '[]'`);
      }
    },
  },
  {
    version: 4,
    name: "目录导入审计表 catalog_import_runs（BuildCores 导入器，ADR §8.1）",
    up: (db) => {
      db.run(sql`CREATE TABLE IF NOT EXISTS catalog_import_runs (
        id text PRIMARY KEY NOT NULL,
        upstream_commit text NOT NULL,
        upstream_url text,
        license text NOT NULL,
        source_path text NOT NULL,
        imported_at text NOT NULL,
        files_read integer NOT NULL,
        imported_count integer NOT NULL,
        skipped_count integer NOT NULL,
        error_count integer NOT NULL,
        errors text NOT NULL DEFAULT '[]'
      )`);
    },
  },
  {
    version: 5,
    name: "价格证据表 price_evidence（追加式快照，规格 §8.2）",
    up: (db) => {
      db.run(sql`CREATE TABLE IF NOT EXISTS price_evidence (
        id text PRIMARY KEY NOT NULL,
        category text NOT NULL,
        product_name text NOT NULL,
        price_cents integer NOT NULL,
        price_basis text,
        source_type text NOT NULL,
        platform text,
        shop text,
        condition text,
        evidence_url text,
        note text,
        captured_at text NOT NULL,
        created_at text NOT NULL
      )`);
    },
  },
  {
    version: 6,
    name: "目标驱动方案：design_requests / proposals / agent_runs / events",
    up: (db) => {
      db.run(sql`CREATE TABLE IF NOT EXISTS design_requests (
        id text PRIMARY KEY NOT NULL,
        raw_input text NOT NULL,
        intent text NOT NULL,
        status text NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )`);
      db.run(sql`CREATE TABLE IF NOT EXISTS design_proposals (
        id text PRIMARY KEY NOT NULL,
        request_id text NOT NULL,
        version integer NOT NULL,
        status text NOT NULL,
        title text NOT NULL,
        summary text NOT NULL,
        budget_cents integer,
        estimated_low_cents integer,
        estimated_high_cents integer,
        accepted_build_id text,
        fit_notes text NOT NULL DEFAULT '[]',
        tradeoffs text NOT NULL DEFAULT '[]',
        unknowns text NOT NULL DEFAULT '[]',
        compatibility text NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )`);
      db.run(sql`CREATE TABLE IF NOT EXISTS proposal_items (
        id text PRIMARY KEY NOT NULL,
        proposal_id text NOT NULL,
        category text NOT NULL,
        label text NOT NULL,
        catalog_id text,
        spec text NOT NULL DEFAULT '{}',
        source_level text NOT NULL,
        price_estimate_low_cents integer,
        price_estimate_high_cents integer,
        price_basis text NOT NULL,
        rationale text NOT NULL,
        confirmation_required integer NOT NULL DEFAULT 0,
        confirmation_reason text
      )`);
      db.run(sql`CREATE TABLE IF NOT EXISTS agent_runs (
        id text PRIMARY KEY NOT NULL,
        request_id text NOT NULL,
        proposal_id text,
        status text NOT NULL,
        created_at text NOT NULL,
        completed_at text
      )`);
      db.run(sql`CREATE TABLE IF NOT EXISTS agent_events (
        id text PRIMARY KEY NOT NULL,
        run_id text NOT NULL,
        type text NOT NULL,
        status text NOT NULL,
        message text NOT NULL,
        created_at text NOT NULL
      )`);
      const columns = db.all<{ name: string }>(sql`PRAGMA table_info(design_proposals)`);
      if (!columns.some((column) => column.name === "accepted_build_id")) {
        db.run(sql`ALTER TABLE design_proposals ADD COLUMN accepted_build_id text`);
      }
    },
  },
  {
    version: 7,
    name: "自有规格库 canonical_products（ADR §8.1：决策字段 + 来源 + 商品页链接）",
    up: (db) => {
      db.run(sql`CREATE TABLE IF NOT EXISTS canonical_products (
        id text PRIMARY KEY NOT NULL,
        category text NOT NULL,
        name text NOT NULL,
        aliases text NOT NULL DEFAULT '[]',
        spec text NOT NULL DEFAULT '{}',
        source text NOT NULL,
        ref_url text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )`);
      db.run(sql`CREATE INDEX IF NOT EXISTS idx_canonical_products_category
        ON canonical_products(category)`);
    },
  },
  {
    version: 8,
    name: "目录数据质量：产品来源/字段证据/质量事件/待审核队列 + canonical_products 身份列",
    up: (db) => {
      db.run(sql`CREATE TABLE IF NOT EXISTS product_sources (
        id text PRIMARY KEY NOT NULL,
        canonical_product_id text NOT NULL,
        source_type text NOT NULL,
        tier text NOT NULL,
        source_url text NOT NULL,
        source_title text NOT NULL,
        source_version text,
        license text,
        captured_at text NOT NULL,
        content_hash text NOT NULL,
        status text NOT NULL,
        reviewer_note text,
        created_at text NOT NULL
      )`);
      db.run(sql`CREATE INDEX IF NOT EXISTS idx_product_sources_product
        ON product_sources(canonical_product_id)`);
      db.run(sql`CREATE TABLE IF NOT EXISTS product_field_evidence (
        id text PRIMARY KEY NOT NULL,
        canonical_product_id text NOT NULL,
        field_path text NOT NULL,
        source_id text NOT NULL,
        value text NOT NULL,
        excerpt text NOT NULL,
        identity_match text NOT NULL,
        confidence text NOT NULL,
        verified_at text,
        verified_by text,
        supersedes_id text,
        created_at text NOT NULL
      )`);
      db.run(sql`CREATE INDEX IF NOT EXISTS idx_field_evidence_product_field
        ON product_field_evidence(canonical_product_id, field_path)`);
      db.run(sql`CREATE TABLE IF NOT EXISTS data_quality_events (
        id text PRIMARY KEY NOT NULL,
        canonical_product_id text NOT NULL,
        event_type text NOT NULL,
        before_json text,
        after_json text,
        reason text NOT NULL,
        actor text NOT NULL,
        created_at text NOT NULL
      )`);
      db.run(sql`CREATE INDEX IF NOT EXISTS idx_quality_events_product
        ON data_quality_events(canonical_product_id)`);
      db.run(sql`CREATE TABLE IF NOT EXISTS pending_catalog_queue (
        id text PRIMARY KEY NOT NULL,
        queue_type text NOT NULL,
        category text NOT NULL,
        user_input text,
        candidate_ids text NOT NULL DEFAULT '[]',
        missing_fields text NOT NULL DEFAULT '[]',
        priority text NOT NULL,
        reason text NOT NULL,
        status text NOT NULL,
        assigned_to text,
        resolution_note text,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        resolved_at text
      )`);
      db.run(sql`CREATE INDEX IF NOT EXISTS idx_pending_catalog_queue_status
        ON pending_catalog_queue(status)`);
      const columns = db.all<{ name: string }>(sql`PRAGMA table_info(canonical_products)`);
      const names = columns.map((column) => column.name);
      if (!names.includes("manufacturer")) {
        db.run(sql`ALTER TABLE canonical_products ADD COLUMN manufacturer text`);
      }
      if (!names.includes("series")) {
        db.run(sql`ALTER TABLE canonical_products ADD COLUMN series text`);
      }
      if (!names.includes("model")) {
        db.run(sql`ALTER TABLE canonical_products ADD COLUMN model text`);
      }
      if (!names.includes("variant")) {
        db.run(sql`ALTER TABLE canonical_products ADD COLUMN variant text`);
      }
      if (!names.includes("mpn")) {
        db.run(sql`ALTER TABLE canonical_products ADD COLUMN mpn text`);
      }
      // 存量行无证据记录，按 partial 处理（可搜索，规则涉及缺失字段时返回 unknown）
      if (!names.includes("quality_status")) {
        db.run(sql`ALTER TABLE canonical_products ADD COLUMN quality_status text NOT NULL DEFAULT 'partial'`);
      }
      if (!names.includes("source_version")) {
        db.run(sql`ALTER TABLE canonical_products ADD COLUMN source_version text`);
      }
    },
  },
  {
    version: 9,
    name: "canonical_products 合并映射列 merged_into（人工合并去重：旧 id 保留可解析，不再进候选）",
    up: (db) => {
      const columns = db.all<{ name: string }>(sql`PRAGMA table_info(canonical_products)`);
      if (!columns.some((column) => column.name === "merged_into")) {
        db.run(sql`ALTER TABLE canonical_products ADD COLUMN merged_into text`);
      }
    },
  },
  {
    version: 10,
    name: "price_evidence 隔离强化：canonicalId 绑定 + 地区 + 审核状态（Task 8）",
    up: (db) => {
      const columns = db.all<{ name: string }>(sql`PRAGMA table_info(price_evidence)`);
      const names = columns.map((column) => column.name);
      // 价格与规格的隔离边界：canonicalId 只做关联，绝不影响规格的质量状态
      if (!names.includes("canonical_product_id")) {
        db.run(sql`ALTER TABLE price_evidence ADD COLUMN canonical_product_id text`);
      }
      if (!names.includes("region")) {
        db.run(sql`ALTER TABLE price_evidence ADD COLUMN region text`);
      }
      if (!names.includes("review_status")) {
        db.run(sql`ALTER TABLE price_evidence ADD COLUMN review_status text NOT NULL DEFAULT 'unreviewed'`);
      }
    },
  },
  {
    version: 11,
    name: "产品内核恢复：方案项质量上下文 + 配件字段质量/证据引用（内核恢复计划 Task A）",
    up: (db) => {
      const proposalColumns = db.all<{ name: string }>(sql`PRAGMA table_info(proposal_items)`);
      // 方案项质量上下文（qualityStatus / evidenceSourceIds / fieldQuality）整体 JSON；
      // null = 旧引擎写出的历史行，读取时按 unknown 质量处理，不冒充已核。
      if (!proposalColumns.map((column) => column.name).includes("quality_json")) {
        db.run(sql`ALTER TABLE proposal_items ADD COLUMN quality_json text`);
      }
      const itemColumns = db.all<{ name: string }>(sql`PRAGMA table_info(build_items)`);
      // 接受方案时下传的字段质量层与证据引用：让 gateFieldQuality 在重开/复检后仍然生效
      if (!itemColumns.map((column) => column.name).includes("field_quality")) {
        db.run(sql`ALTER TABLE build_items ADD COLUMN field_quality text`);
      }
      if (!itemColumns.map((column) => column.name).includes("evidence_source_ids")) {
        db.run(sql`ALTER TABLE build_items ADD COLUMN evidence_source_ids text`);
      }
    },
  },
];

export function readSchemaVersion(db: RigmateDatabase): number {
  const rows = db.all<{ version: number }>(
    sql`SELECT version FROM schema_version WHERE id = 1`,
  );
  return rows[0]?.version ?? 0;
}

function stampSchemaVersion(db: RigmateDatabase, version: number): void {
  db.run(sql`
    INSERT INTO schema_version (id, version, applied_at)
    VALUES (1, ${version}, ${new Date().toISOString()})
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at
  `);
}

export function migrateSchema(db: RigmateDatabase): MigrationResult {
  db.run(sql`CREATE TABLE IF NOT EXISTS schema_version (
    id integer PRIMARY KEY CHECK (id = 1),
    version integer NOT NULL,
    applied_at text NOT NULL
  )`);

  const from = readSchemaVersion(db);

  if (from > LATEST_SCHEMA_VERSION) {
    console.warn(
      `[rigmate-db] 数据库 schema 版本 v${from} 高于代码支持的 v${LATEST_SCHEMA_VERSION}` +
        `（可能回滚过代码）。已拒绝迁移；请勿用旧版本代码继续写入这个数据库。`,
    );
    return { from, to: from, applied: [], refusedDowngrade: true };
  }

  const applied: MigrationRecord[] = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    migration.up(db);
    // up() 成功才推进版本：中途抛错时版本不前移，下次启动重跑同一步
    stampSchemaVersion(db, migration.version);
    applied.push({ version: migration.version, name: migration.name });
    console.info(`[rigmate-db] 已应用迁移 v${migration.version}：${migration.name}`);
  }

  const to = applied.length > 0 ? applied[applied.length - 1]!.version : from;
  console.info(`[rigmate-db] schema 版本 v${to}（本次迁移 ${applied.length} 步）。`);
  return { from, to, applied, refusedDowngrade: false };
}
