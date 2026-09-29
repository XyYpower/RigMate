import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { buildItemCategorySchema } from "@/domain/build/types";
import { isValidSpecFieldValue } from "@/domain/catalog/quality";
import type { EvidenceStatus, IdentityMatch, SourceTier } from "@/domain/catalog/quality";
import {
  productFieldEvidenceSchema,
  productSourceSchema,
  type ProductFieldEvidence,
  type ProductSource,
  type ProductSourceType,
} from "@/contracts/catalog";
import { canonicalProducts, ensureDatabase, productFieldEvidence, productSources } from "../client";

/**
 * 产品来源与字段级证据仓储（PROVENANCE §4）。
 *
 * 纪律：
 * - 双表都**追加式**：来源只插入与改审核状态（带状态机），证据只插入与查询，绝不 UPDATE 值；
 * - 证据值写入前必须通过该产品类别的 spec schema（错误单位在门口炸出来）；
 * - fieldPath 必须形如 "spec.<field>" 且字段真实存在于类别 schema；
 * - 冲突不覆盖：同一字段多条证据并存，判定交给 domain/catalog/quality.ts 纯函数。
 */

/** 来源审核状态机：rejected 为终态，其余状态可复核流转 */
const SOURCE_STATUS_TRANSITIONS: Record<EvidenceStatus, EvidenceStatus[]> = {
  unreviewed: ["verified", "conflicting", "stale", "rejected"],
  verified: ["conflicting", "stale", "rejected"],
  conflicting: ["verified", "stale", "rejected"],
  stale: ["verified", "rejected"],
  rejected: [],
};

export type AddProductSourceInput = Omit<ProductSource, "id">;

export function addProductSource(input: AddProductSourceInput): ProductSource {
  const record = productSourceSchema.parse({ ...input, id: `src-${randomUUID()}` });
  ensureDatabase()
    .insert(productSources)
    .values({
      id: record.id,
      canonicalProductId: record.canonicalProductId,
      sourceType: record.sourceType,
      tier: record.tier,
      sourceUrl: record.sourceUrl,
      sourceTitle: record.sourceTitle,
      sourceVersion: record.sourceVersion,
      license: record.license,
      capturedAt: record.capturedAt,
      contentHash: record.contentHash,
      status: record.status,
      reviewerNote: record.reviewerNote,
      createdAt: new Date().toISOString(),
    })
    .run();
  return record;
}

export function listProductSources(canonicalProductId: string): ProductSource[] {
  return ensureDatabase()
    .select()
    .from(productSources)
    .where(eq(productSources.canonicalProductId, canonicalProductId))
    .orderBy(desc(productSources.capturedAt))
    .all()
    .map((row) =>
      productSourceSchema.parse({
        id: row.id,
        canonicalProductId: row.canonicalProductId,
        sourceType: row.sourceType as ProductSourceType,
        tier: row.tier as SourceTier,
        sourceUrl: row.sourceUrl,
        sourceTitle: row.sourceTitle,
        sourceVersion: row.sourceVersion,
        license: row.license,
        capturedAt: row.capturedAt,
        contentHash: row.contentHash,
        status: row.status,
        reviewerNote: row.reviewerNote,
      }),
    );
}

/** 审核状态流转（unreviewed → verified / conflicting / stale / rejected）；非法流转抛错 */
export function transitionProductSourceStatus(
  sourceId: string,
  nextStatus: EvidenceStatus,
  reviewerNote?: string,
): ProductSource {
  const db = ensureDatabase();
  const row = db.select().from(productSources).where(eq(productSources.id, sourceId)).get();
  if (!row) throw new Error(`来源不存在：${sourceId}`);
  const current = row.status as EvidenceStatus;
  if (!SOURCE_STATUS_TRANSITIONS[current].includes(nextStatus)) {
    throw new Error(`非法的来源状态流转：${current} → ${nextStatus}`);
  }
  db.update(productSources)
    .set({ status: nextStatus, reviewerNote: reviewerNote ?? row.reviewerNote })
    .where(eq(productSources.id, sourceId))
    .run();
  const updated = db.select().from(productSources).where(eq(productSources.id, sourceId)).get();
  return productSourceSchema.parse({
    id: updated!.id,
    canonicalProductId: updated!.canonicalProductId,
    sourceType: updated!.sourceType as ProductSourceType,
    tier: updated!.tier as SourceTier,
    sourceUrl: updated!.sourceUrl,
    sourceTitle: updated!.sourceTitle,
    sourceVersion: updated!.sourceVersion,
    license: updated!.license,
    capturedAt: updated!.capturedAt,
    contentHash: updated!.contentHash,
    status: updated!.status,
    reviewerNote: updated!.reviewerNote,
  });
}

export type AddFieldEvidenceInput = Omit<ProductFieldEvidence, "id" | "createdAt"> & { createdAt?: string };

/** 追加字段证据：值过 schema、来源必须已登记且属于同一产品，坏数据在门口拒绝 */
export function addFieldEvidence(input: AddFieldEvidenceInput): ProductFieldEvidence {
  const db = ensureDatabase();
  const product = db
    .select({ category: canonicalProducts.category })
    .from(canonicalProducts)
    .where(eq(canonicalProducts.id, input.canonicalProductId))
    .get();
  if (!product) throw new Error(`产品不存在：${input.canonicalProductId}，请先走人工目录确认流程`);
  const category = buildItemCategorySchema.parse(product.category);

  const field = input.fieldPath.replace(/^spec\./, "");
  if (input.fieldPath !== `spec.${field}` || field.includes(".")) {
    throw new Error(`fieldPath 必须形如 "spec.<field>"：${input.fieldPath}`);
  }
  if (input.value === undefined) throw new Error("字段证据的 value 不能为 undefined（缺失请不录证据）");
  if (!isValidSpecFieldValue(category, field, input.value)) {
    throw new Error(`证据值不符合 ${category}.${field} 的 schema（单位或类型错误）：${JSON.stringify(input.value)}`);
  }
  const source = db
    .select({ canonicalProductId: productSources.canonicalProductId })
    .from(productSources)
    .where(eq(productSources.id, input.sourceId))
    .get();
  if (!source || source.canonicalProductId !== input.canonicalProductId) {
    throw new Error(`来源不存在或不属于该产品：${input.sourceId}`);
  }

  const record = productFieldEvidenceSchema.parse({
    ...input,
    id: `ev-${randomUUID()}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  db.insert(productFieldEvidence)
    .values({
      id: record.id,
      canonicalProductId: record.canonicalProductId,
      fieldPath: record.fieldPath,
      sourceId: record.sourceId,
      value: JSON.stringify(record.value ?? null),
      excerpt: record.excerpt,
      identityMatch: record.identityMatch,
      confidence: record.confidence,
      verifiedAt: record.verifiedAt,
      verifiedBy: record.verifiedBy,
      supersedesId: record.supersedesId,
      createdAt: record.createdAt,
    })
    .run();
  return record;
}

/** 按字段读取证据（fieldPath 缺省 = 该产品全部证据），新证据在前 */
export function listFieldEvidence(
  canonicalProductId: string,
  fieldPath?: string,
): ProductFieldEvidence[] {
  const conditions = [
    eq(productFieldEvidence.canonicalProductId, canonicalProductId),
    fieldPath ? eq(productFieldEvidence.fieldPath, fieldPath) : undefined,
  ].filter((condition) => condition !== undefined);
  return ensureDatabase()
    .select()
    .from(productFieldEvidence)
    .where(and(...conditions))
    .orderBy(desc(productFieldEvidence.createdAt))
    .all()
    .map((row) =>
      productFieldEvidenceSchema.parse({
        id: row.id,
        canonicalProductId: row.canonicalProductId,
        fieldPath: row.fieldPath,
        sourceId: row.sourceId,
        value: JSON.parse(row.value) as unknown,
        excerpt: row.excerpt,
        identityMatch: row.identityMatch as IdentityMatch,
        confidence: row.confidence,
        verifiedAt: row.verifiedAt,
        verifiedBy: row.verifiedBy,
        supersedesId: row.supersedesId,
        createdAt: row.createdAt,
      }),
    );
}

/** 按 id 读取单条证据（审核操作定位用） */
export function findFieldEvidence(evidenceId: string): ProductFieldEvidence | null {
  const row = ensureDatabase()
    .select()
    .from(productFieldEvidence)
    .where(eq(productFieldEvidence.id, evidenceId))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    canonicalProductId: row.canonicalProductId,
    fieldPath: row.fieldPath,
    sourceId: row.sourceId,
    value: JSON.parse(row.value) as unknown,
    excerpt: row.excerpt,
    identityMatch: row.identityMatch as IdentityMatch,
    confidence: row.confidence as ProductFieldEvidence["confidence"],
    verifiedAt: row.verifiedAt,
    verifiedBy: row.verifiedBy,
    supersedesId: row.supersedesId,
    createdAt: row.createdAt,
  };
}

/** 人工复核盖章：写入 verifiedAt/verifiedBy（证据唯一允许的 UPDATE，其余字段不可改） */
export function verifyFieldEvidence(evidenceId: string, verifiedBy: string, verifiedAt?: string): void {
  const result = ensureDatabase()
    .update(productFieldEvidence)
    .set({ verifiedBy, verifiedAt: verifiedAt ?? new Date().toISOString() })
    .where(eq(productFieldEvidence.id, evidenceId))
    .run();
  if (result.changes === 0) throw new Error(`证据不存在：${evidenceId}`);
}

/** 来源 id → 所属产品 id（审核服务定位用） */
export function findProductSourceOwner(sourceId: string): string | null {
  const row = ensureDatabase()
    .select({ canonicalProductId: productSources.canonicalProductId })
    .from(productSources)
    .where(eq(productSources.id, sourceId))
    .get();
  return row?.canonicalProductId ?? null;
}

/** 证据覆盖统计（质量报表用）：总证据/已复核/有证据产品数/产品-字段对数 */
export type EvidenceCoverageStats = {
  total: number;
  verified: number;
  productsWithEvidence: number;
  productFieldPairs: number;
};

export function evidenceCoverageStats(): EvidenceCoverageStats {
  const row = ensureDatabase()
    .select({
      total: sql<number>`count(*)`,
      verified: sql<number>`sum(case when verified_at is not null then 1 else 0 end)`,
      productsWithEvidence: sql<number>`count(distinct ${productFieldEvidence.canonicalProductId})`,
      productFieldPairs: sql<number>`count(distinct ${productFieldEvidence.canonicalProductId} || '|' || ${productFieldEvidence.fieldPath})`,
    })
    .from(productFieldEvidence)
    .get();
  return {
    total: row?.total ?? 0,
    verified: row?.verified ?? 0,
    productsWithEvidence: row?.productsWithEvidence ?? 0,
    productFieldPairs: row?.productFieldPairs ?? 0,
  };
}

/** 合并去重：把被合并条目的来源与证据整体改挂到保留条目名下（事件流水不动，保留历史） */
export function reattachProductDataTo(duplicateId: string, keepId: string): { sources: number; evidence: number } {
  const db = ensureDatabase();
  const sources = db
    .update(productSources)
    .set({ canonicalProductId: keepId })
    .where(eq(productSources.canonicalProductId, duplicateId))
    .run().changes;
  const evidence = db
    .update(productFieldEvidence)
    .set({ canonicalProductId: keepId })
    .where(eq(productFieldEvidence.canonicalProductId, duplicateId))
    .run().changes;
  return { sources, evidence };
}
