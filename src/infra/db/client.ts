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

export const priceEvidence = sqliteTable("price_evidence", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  productName: text("product_name").notNull(),
  priceCents: integer("price_cents").notNull(),
  priceBasis: text("price_basis"),
  sourceType: text("source_type").notNull(),
  platform: text("platform"),
  shop: text("shop"),
  condition: text("condition"),
  evidenceUrl: text("evidence_url"),
  note: text("note"),
  capturedAt: text("captured_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const designRequests = sqliteTable("design_requests", {
  id: text("id").primaryKey(),
  rawInput: text("raw_input").notNull(),
  intent: text("intent").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const designProposals = sqliteTable("design_proposals", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  budgetCents: integer("budget_cents"),
  estimatedLowCents: integer("estimated_low_cents"),
  estimatedHighCents: integer("estimated_high_cents"),
  acceptedBuildId: text("accepted_build_id"),
  fitNotes: text("fit_notes").notNull().default("[]"),
  tradeoffs: text("tradeoffs").notNull().default("[]"),
  unknowns: text("unknowns").notNull().default("[]"),
  compatibility: text("compatibility").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const proposalItems = sqliteTable("proposal_items", {
  id: text("id").primaryKey(),
  proposalId: text("proposal_id").notNull(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  catalogId: text("catalog_id"),
  spec: text("spec").notNull().default("{}"),
  sourceLevel: text("source_level").notNull(),
  priceEstimateLowCents: integer("price_estimate_low_cents"),
  priceEstimateHighCents: integer("price_estimate_high_cents"),
  priceBasis: text("price_basis").notNull(),
  rationale: text("rationale").notNull(),
  confirmationRequired: integer("confirmation_required", { mode: "boolean" }).notNull().default(false),
  confirmationReason: text("confirmation_reason"),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  proposalId: text("proposal_id"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export const agentEvents = sqliteTable("agent_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
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
