import { z } from "zod";
import { buildItemCategorySchema } from "@/domain/build/types";
import {
  evidenceStatusSchema,
  identityMatchSchema,
  productIdentitySchema,
  publishStatusSchema,
  sourceTierSchema,
} from "@/domain/catalog/quality";

/**
 * 目录数据质量契约（docs/DATA_PROVENANCE_AND_QUALITY.md §4、DATA_OPERATIONS_PLAYBOOK.md §4/§5）
 *
 * 字段级证据是追加式事实：证据不覆盖、产品不合并、事件不删除；
 * canonicalProductId 沿用目录现有 slug id（如 "cpu-9800x3d"），不是 uuid。
 */

const canonicalProductIdSchema = z.string().trim().min(1).max(80);
const isoDatetimeSchema = z.string().datetime();
/** 系统生成的记录 id（如 "ev-<uuid>"，沿用 price evidence "pe-" 前缀惯例，便于 DB 排查） */
const recordIdSchema = z.string().trim().min(1).max(64);

// ---- 产品来源（PROVENANCE §4 product_sources）----

export const productSourceTypeSchema = z.enum([
  "manufacturer",
  "manual",
  "buildcores",
  "parameter_media",
  "user_submission",
  "price_evidence",
]);
export type ProductSourceType = z.infer<typeof productSourceTypeSchema>;

export const productSourceSchema = z.object({
  id: recordIdSchema,
  canonicalProductId: canonicalProductIdSchema,
  sourceType: productSourceTypeSchema,
  /** 该来源按内容定性后的等级（manufacturer/manual→S1，buildcores→S2……以录入时判定为准） */
  tier: sourceTierSchema,
  sourceUrl: z.string().trim().url().max(500),
  sourceTitle: z.string().trim().min(1).max(300),
  /** upstream commit、页面版本号等；人工页面无版本时为 null */
  sourceVersion: z.string().trim().max(120).nullable(),
  license: z.string().trim().max(120).nullable(),
  capturedAt: isoDatetimeSchema,
  /** 页面/快照内容哈希（≥8 位），用于检测来源变化 */
  contentHash: z.string().trim().min(8).max(128),
  status: evidenceStatusSchema,
  reviewerNote: z.string().trim().max(500).nullable(),
});
export type ProductSource = z.infer<typeof productSourceSchema>;

// ---- 字段级证据（PROVENANCE §4 product_field_evidence）----

export const productFieldEvidenceSchema = z.object({
  id: recordIdSchema,
  canonicalProductId: canonicalProductIdSchema,
  /** 形如 "spec.lengthMm" */
  fieldPath: z.string().trim().regex(/^spec\.[A-Za-z][A-Za-z0-9_]*$/, "fieldPath 必须形如 spec.<field>"),
  sourceId: recordIdSchema,
  /** 字段值（存储为 JSON）；单位与类型必须通过类别 spec schema */
  value: z.unknown(),
  /** 字段原文摘录（页面原句/表格行），不是模型理由 */
  excerpt: z.string().trim().min(1).max(600),
  identityMatch: identityMatchSchema,
  confidence: z.enum(["high", "medium", "low"]),
  /** 人工复核时间；null = 未复核（此时字段封顶 supported） */
  verifiedAt: isoDatetimeSchema.nullable(),
  verifiedBy: z.string().trim().max(80).nullable(),
  /** 本条证据取代的旧证据 id（追加式，不覆盖旧记录） */
  supersedesId: recordIdSchema.nullable(),
  createdAt: isoDatetimeSchema,
});
export type ProductFieldEvidence = z.infer<typeof productFieldEvidenceSchema>;

// ---- 数据质量事件（PROVENANCE §4 data_quality_events）----

export const qualityEventTypeSchema = z.enum([
  "imported",
  "reviewed",
  "corrected",
  "conflict",
  "deprecated",
  "merged",
]);
export type QualityEventType = z.infer<typeof qualityEventTypeSchema>;

export const dataQualityEventSchema = z.object({
  id: recordIdSchema,
  canonicalProductId: canonicalProductIdSchema,
  eventType: qualityEventTypeSchema,
  beforeJson: z.record(z.string(), z.unknown()).nullable(),
  afterJson: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().trim().min(1).max(500),
  actor: z.string().trim().min(1).max(80),
  createdAt: isoDatetimeSchema,
});
export type DataQualityEvent = z.infer<typeof dataQualityEventSchema>;

// ---- 待审核队列（PLAYBOOK §5：new_product / missing_field / conflict / stale）----

export const reviewQueueTypeSchema = z.enum(["new_product", "missing_field", "conflict", "stale"]);
export type ReviewQueueType = z.infer<typeof reviewQueueTypeSchema>;

export const reviewQueueStatusSchema = z.enum(["open", "processing", "resolved", "dismissed"]);
export type ReviewQueueStatus = z.infer<typeof reviewQueueStatusSchema>;

export const reviewQueuePrioritySchema = z.enum(["high", "normal", "low"]);
export type ReviewQueuePriority = z.infer<typeof reviewQueuePrioritySchema>;

export const pendingCatalogItemSchema = z.object({
  id: recordIdSchema,
  queueType: reviewQueueTypeSchema,
  category: buildItemCategorySchema,
  /** 用户原文（new_product 场景保存原文，不让模型猜型号） */
  userInput: z.string().trim().max(400).nullable(),
  candidateCanonicalIds: z.array(canonicalProductIdSchema).max(20),
  missingFields: z.array(z.string().trim().min(1).max(60)).max(20),
  priority: reviewQueuePrioritySchema,
  reason: z.string().trim().min(1).max(300),
  status: reviewQueueStatusSchema,
  assignedTo: z.string().trim().max(80).nullable(),
  resolutionNote: z.string().trim().max(500).nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
  resolvedAt: isoDatetimeSchema.nullable(),
});
export type PendingCatalogItem = z.infer<typeof pendingCatalogItemSchema>;

// ---- 扩展后的 canonical product（Task 1：身份五元组 + 质量列）----

export const canonicalProductRecordSchema = productIdentitySchema.extend({
  id: canonicalProductIdSchema,
  category: buildItemCategorySchema,
  name: z.string().trim().min(1).max(180),
  aliases: z.array(z.string().trim().min(1).max(180)).max(20),
  spec: z.record(z.string(), z.unknown()),
  refUrl: z.string().trim().url().max(500).nullable(),
  /** 产品级发布状态（由必填字段状态聚合，见 domain/catalog/quality.ts） */
  qualityStatus: publishStatusSchema,
  /** 当前生效的来源版本（upstream commit 等） */
  sourceVersion: z.string().trim().max(120).nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});
export type CanonicalProductRecord = z.infer<typeof canonicalProductRecordSchema>;
