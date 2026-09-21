import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { migrateSchema } from "./migrate";

export const builds = sqliteTable("builds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  useCase: text("use_case"),
  budgetCents: integer("budget_cents"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const buildItems = sqliteTable("build_items", {
  id: text("id").primaryKey(),
  buildId: text("build_id").notNull(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  spec: text("spec").notNull().default("{}"),
  priceCents: integer("price_cents"),
  source: text("source"),
  createdAt: text("created_at").notNull(),
});

export const checkRuns = sqliteTable("check_runs", {
  id: text("id").primaryKey(),
  buildId: text("build_id").notNull(),
  createdAt: text("created_at").notNull(),
  status: text("status").notNull(),
  itemsSnapshot: text("items_snapshot").notNull().default("[]"),
});

export const findings = sqliteTable("findings", {
  id: text("id").primaryKey(),
  checkRunId: text("check_run_id").notNull(),
  ruleId: text("rule_id").notNull(),
  status: text("status").notNull(),
  payload: text("payload").notNull(),
});

export const catalogImportRuns = sqliteTable("catalog_import_runs", {
  id: text("id").primaryKey(),
  upstreamCommit: text("upstream_commit").notNull(),
  upstreamUrl: text("upstream_url"),
  license: text("license").notNull(),
  sourcePath: text("source_path").notNull(),
  importedAt: text("imported_at").notNull(),
  filesRead: integer("files_read").notNull(),
  importedCount: integer("imported_count").notNull(),
  skippedCount: integer("skipped_count").notNull(),
  errorCount: integer("error_count").notNull(),
  errors: text("errors").notNull().default("[]"),
});

export type RigmateDatabase = BetterSQLite3Database<Record<string, never>>;

type DatabaseStore = {
  __rigmateDb?: RigmateDatabase;
  __rigmateSqlite?: Database.Database;
};

const globalStore = globalThis as unknown as DatabaseStore;

function resolveDatabasePath(): string {
  return process.env.RIGMATE_DB_PATH ?? "./data/rigmate.db";
}

export function ensureDatabase(): RigmateDatabase {
  if (globalStore.__rigmateDb) {
    return globalStore.__rigmateDb;
  }
  const path = resolveDatabasePath();
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  migrateSchema(db);
  globalStore.__rigmateDb = db;
  globalStore.__rigmateSqlite = sqlite;
  return db;
}

export function closeDatabase(): void {
  globalStore.__rigmateSqlite?.close();
  globalStore.__rigmateSqlite = undefined;
  globalStore.__rigmateDb = undefined;
}
