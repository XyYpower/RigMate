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

export const LATEST_SCHEMA_VERSION = 5;

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
