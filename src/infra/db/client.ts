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
  /** 字段质量层 JSON（v11，内核恢复 Task A）：接受方案时下传，gateFieldQuality 依据 */
  fieldQuality: text("field_quality"),
  /** 证据来源引用 JSON 数组（v11）：product_sources.id 列表，可回溯 */
  evidenceSourceIds: text("evidence_source_ids"),
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
  /** 关联目录条目（Task 8）：只做关联，绝不影响该产品的规格质量状态 */
  canonicalProductId: text("canonical_product_id"),
  /** 价格地区（Task 8）：如"中国大陆"；跨区价格不可比 */
  region: text("region"),
  /** 审核状态（Task 8）：unreviewed / verified / rejected */
  reviewStatus: text("review_status").notNull().default("unreviewed"),
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
  /** 方案项质量上下文 JSON（v11，内核恢复 Task A）：qualityStatus/fieldQuality/evidenceSourceIds */
  qualityJson: text("quality_json"),
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

/** 自有规格库（M29，ADR §8.1 canonical_products 的落地表）：八类配件决策字段，导入时校验 */
export const canonicalProducts = sqliteTable("canonical_products", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  aliases: text("aliases").notNull().default("[]"),
  spec: text("spec").notNull().default("{}"),
  source: text("source").notNull(),
  refUrl: text("ref_url"),
  manufacturer: text("manufacturer"),
  series: text("series"),
  model: text("model"),
  variant: text("variant"),
  mpn: text("mpn"),
  qualityStatus: text("quality_status").notNull().default("partial"),
  sourceVersion: text("source_version"),
  /** 合并去重（v9）：本条已并入的目标产品 id；非空 = 不再作为候选出现在任何读取路径 */
  mergedInto: text("merged_into"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** 产品来源（PROVENANCE §4）：一次来源访问/录入一行，内容哈希用于检测来源变化 */
export const productSources = sqliteTable("product_sources", {
  id: text("id").primaryKey(),
  canonicalProductId: text("canonical_product_id").notNull(),
  sourceType: text("source_type").notNull(),
  tier: text("tier").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceTitle: text("source_title").notNull(),
  sourceVersion: text("source_version"),
  license: text("license"),
  capturedAt: text("captured_at").notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status").notNull(),
  reviewerNote: text("reviewer_note"),
  createdAt: text("created_at").notNull(),
});

/** 字段级证据（PROVENANCE §4）：追加式，不覆盖旧证据；value 为 JSON 序列化字符串 */
export const productFieldEvidence = sqliteTable("product_field_evidence", {
  id: text("id").primaryKey(),
  canonicalProductId: text("canonical_product_id").notNull(),
  fieldPath: text("field_path").notNull(),
  sourceId: text("source_id").notNull(),
  value: text("value").notNull(),
  excerpt: text("excerpt").notNull(),
  identityMatch: text("identity_match").notNull(),
  confidence: text("confidence").notNull(),
  verifiedAt: text("verified_at"),
  verifiedBy: text("verified_by"),
  supersedesId: text("supersedes_id"),
  createdAt: text("created_at").notNull(),
});

/** 数据质量事件（PROVENANCE §4）：导入/审核/修正/冲突/合并的审计流水 */
export const dataQualityEvents = sqliteTable("data_quality_events", {
  id: text("id").primaryKey(),
  canonicalProductId: text("canonical_product_id").notNull(),
  eventType: text("event_type").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
});

/** 待审核队列（PLAYBOOK §5）：new_product / missing_field / conflict / stale 四类 */
export const pendingCatalogQueue = sqliteTable("pending_catalog_queue", {
  id: text("id").primaryKey(),
  queueType: text("queue_type").notNull(),
  category: text("category").notNull(),
  userInput: text("user_input"),
  candidateIds: text("candidate_ids").notNull().default("[]"),
  missingFields: text("missing_fields").notNull().default("[]"),
  priority: text("priority").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull(),
  assignedTo: text("assigned_to"),
  resolutionNote: text("resolution_note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  resolvedAt: text("resolved_at"),
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
