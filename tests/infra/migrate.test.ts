import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RigmateDatabase } from "@/infra/db/client";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrateSchema,
  readSchemaVersion,
} from "@/infra/db/migrate";

const tempDir = mkdtempSync(join(tmpdir(), "rigmate-migrate-"));
let counter = 0;
const openHandles: Database.Database[] = [];

function openFreshDb(): RigmateDatabase {
  counter += 1;
  const sqlite = new Database(join(tempDir, `db-${counter}.db`));
  openHandles.push(sqlite);
  return drizzle(sqlite);
}

function tableNames(db: RigmateDatabase): string[] {
  return db
    .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .map((row) => row.name);
}

function columnNames(db: RigmateDatabase, table: string): string[] {
  return db
    .all<{ name: string }>(sql`SELECT name FROM pragma_table_info(${table})`)
    .map((row) => row.name);
}

function forceSchemaVersion(db: RigmateDatabase, version: number): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS schema_version (
    id integer PRIMARY KEY CHECK (id = 1),
    version integer NOT NULL,
    applied_at text NOT NULL
  )`);
  db.run(sql`
    INSERT INTO schema_version (id, version, applied_at)
    VALUES (1, ${version}, '2026-09-21T00:00:00.000Z')
    ON CONFLICT(id) DO UPDATE SET version = excluded.version
  `);
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const handle of openHandles) handle.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("数据库迁移版本检测（M18）", () => {
  it("全新库一次性迁移到最新版，版本号落库", () => {
    const db = openFreshDb();
    const result = migrateSchema(db);

    expect(result.from).toBe(0);
    expect(result.to).toBe(LATEST_SCHEMA_VERSION);
    expect(result.applied.map((m) => m.version)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(result.refusedDowngrade).toBe(false);
    expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);

    const tables = tableNames(db);
    for (const table of [
      "builds",
      "build_items",
      "check_runs",
      "findings",
      "schema_version",
      "catalog_import_runs",
      "canonical_products",
    ]) {
      expect(tables).toContain(table);
    }
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining(`v${LATEST_SCHEMA_VERSION}`),
    );
  });

  it("重复迁移是幂等的：已应用步骤不再重跑", () => {
    const db = openFreshDb();
    migrateSchema(db);
    const second = migrateSchema(db);

    expect(second.applied).toEqual([]);
    expect(second.from).toBe(LATEST_SCHEMA_VERSION);
    expect(second.to).toBe(LATEST_SCHEMA_VERSION);
  });

  it("无版本表的历史库安全升级：旧 socket 数据并入 spec，逐列补齐", () => {
    // 模拟 M3 之前的真实旧库形态：有 socket 列、没有 spec/price_cents、没有版本表
    counter += 1;
    const sqlite = new Database(join(tempDir, `db-legacy-${counter}.db`));
    openHandles.push(sqlite);
    sqlite.exec(`
      CREATE TABLE builds (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        use_case text,
        budget_cents integer,
        status text NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE build_items (
        id text PRIMARY KEY NOT NULL,
        build_id text NOT NULL,
        category text NOT NULL,
        label text NOT NULL,
        socket text,
        created_at text NOT NULL
      );
      INSERT INTO builds (id, name, status, created_at, updated_at)
        VALUES ('b1', '旧项目', 'draft', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
      INSERT INTO build_items (id, build_id, category, label, socket, created_at)
        VALUES ('i1', 'b1', 'cpu', '旧 CPU', 'AM5', '2026-09-20T00:00:00.000Z');
    `);
    const db = drizzle(sqlite);

    const result = migrateSchema(db);

    expect(result.to).toBe(LATEST_SCHEMA_VERSION);
    expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);

    const itemColumns = columnNames(db, "build_items");
    expect(itemColumns).toContain("spec");
    expect(itemColumns).toContain("price_cents");
    expect(itemColumns).not.toContain("socket");

    expect(columnNames(db, "check_runs")).toContain("items_snapshot");

    const items = db.all<{ id: string; spec: string; label: string }>(
      sql`SELECT id, spec, label FROM build_items ORDER BY id`,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "i1", label: "旧 CPU" });
    expect(JSON.parse(items[0]!.spec)).toEqual({ socket: "AM5" });

    const builds = db.all<{ id: string; name: string }>(sql`SELECT id, name FROM builds`);
    expect(builds).toEqual([{ id: "b1", name: "旧项目" }]);
  });

  it("已标注版本的库只执行缺失的迁移步骤", () => {
    const db = openFreshDb();
    // 模拟只跑到 v1 的库
    MIGRATIONS[0]!.up(db);
    forceSchemaVersion(db, 1);

    const result = migrateSchema(db);

    expect(result.from).toBe(1);
    expect(result.to).toBe(LATEST_SCHEMA_VERSION);
    expect(result.applied.map((m) => m.version)).toEqual(
      MIGRATIONS.slice(1).map((m) => m.version),
    );
  });

  it("数据库版本高于代码（代码回滚）时拒绝迁移，不动 schema", () => {
    const db = openFreshDb();
    forceSchemaVersion(db, LATEST_SCHEMA_VERSION + 1);

    const result = migrateSchema(db);

    expect(result.refusedDowngrade).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.from).toBe(LATEST_SCHEMA_VERSION + 1);
    // 拒绝迁移时不应该悄悄把缺的表建出来（那会让旧代码写坏新库）
    expect(tableNames(db)).not.toContain("builds");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("高于代码支持"));
  });
});

describe("v14：design_proposals.experience_advice 列（混合建议层）", () => {
  it("v13 库升级后旧方案行获得空数组缺省，幂等重跑无新步骤", () => {
    const db = openFreshDb();
    // 先把库推到 v13（v14 之前的全部迁移）
    for (const migration of MIGRATIONS) {
      if (migration.version <= 13) migration.up(db);
    }
    forceSchemaVersion(db, 13);
    // 按旧列集合插一条方案行（此时还没有 experience_advice 列）
    db.run(sql`INSERT INTO design_proposals (
      id, request_id, version, status, title, summary,
      budget_cents, estimated_low_cents, estimated_high_cents,
      fit_notes, tradeoffs, unknowns, compatibility, created_at, updated_at
    ) VALUES (
      'p-legacy', 'r-legacy', 1, 'ready', '旧方案', '旧摘要',
      2000000, 1500000, 1900000,
      '[]', '[]', '[]',
      '{"status":"ok","message":"通过","blockCount":0,"warnCount":0,"unknownCount":0,"passCount":0}',
      '2026-10-14T00:00:00.000Z', '2026-10-14T00:00:00.000Z'
    )`);

    const result = migrateSchema(db);

    expect(result.to).toBe(LATEST_SCHEMA_VERSION);
    expect(result.applied.map((m) => m.version)).toEqual([14, 15]);
    expect(columnNames(db, "design_proposals")).toContain("experience_advice");
    const legacy = db.all<{ experience_advice: string }>(
      sql`SELECT experience_advice FROM design_proposals WHERE id = 'p-legacy'`,
    );
    expect(JSON.parse(legacy[0]!.experience_advice)).toEqual([]);

    const second = migrateSchema(db);
    expect(second.applied).toEqual([]);
  });
});

describe("v15：design_proposals.reference_prices 列（独立估算层）", () => {
  it("v14 库升级后旧方案行获得空数组缺省，幂等重跑无新步骤", () => {
    const db = openFreshDb();
    for (const migration of MIGRATIONS) {
      if (migration.version <= 14) migration.up(db);
    }
    forceSchemaVersion(db, 14);
    db.run(sql`INSERT INTO design_proposals (
      id, request_id, version, status, title, summary,
      budget_cents, estimated_low_cents, estimated_high_cents,
      fit_notes, tradeoffs, unknowns, experience_advice, compatibility, created_at, updated_at
    ) VALUES (
      'p-legacy15', 'r-legacy15', 1, 'ready', '旧方案', '旧摘要',
      2000000, 1500000, 1900000,
      '[]', '[]', '[]', '[]',
      '{"status":"ok","message":"通过","blockCount":0,"warnCount":0,"unknownCount":0,"passCount":0}',
      '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'
    )`);

    const result = migrateSchema(db);

    expect(result.to).toBe(LATEST_SCHEMA_VERSION);
    expect(result.applied.map((m) => m.version)).toEqual([15]);
    expect(columnNames(db, "design_proposals")).toContain("reference_prices");
    const legacy = db.all<{ reference_prices: string }>(
      sql`SELECT reference_prices FROM design_proposals WHERE id = 'p-legacy15'`,
    );
    expect(JSON.parse(legacy[0]!.reference_prices)).toEqual([]);

    const second = migrateSchema(db);
    expect(second.applied).toEqual([]);
  });
});
