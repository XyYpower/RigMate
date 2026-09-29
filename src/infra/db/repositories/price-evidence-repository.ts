import { randomUUID } from "node:crypto";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { priceEvidence, ensureDatabase } from "../client";
import type { PriceEvidenceInput, PriceEvidenceRecord, PriceReviewStatus } from "@/domain/price/evidence";

/**
 * price_evidence 仓储（规格 §8.2 + Task 8 隔离强化）：**追加式**——价格值只有插入与查询，
 * 不提供修改/删除接口；旧证据永远保留，价格判断由消费方按时间取用。
 * 唯一允许的 UPDATE 是 reviewStatus（审核结论不是价格事实本身）。
 */

function toRecord(row: typeof priceEvidence.$inferSelect): PriceEvidenceRecord {
  return {
    id: row.id,
    category: row.category as PriceEvidenceInput["category"],
    productName: row.productName,
    priceCents: row.priceCents,
    priceBasis: row.priceBasis ?? undefined,
    sourceType: row.sourceType as PriceEvidenceInput["sourceType"],
    platform: row.platform ?? undefined,
    shop: row.shop ?? undefined,
    condition: row.condition ?? undefined,
    canonicalProductId: row.canonicalProductId ?? undefined,
    region: row.region ?? undefined,
    reviewStatus: row.reviewStatus as PriceReviewStatus,
    evidenceUrl: row.evidenceUrl ?? undefined,
    note: row.note ?? undefined,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
  };
}

export function addPriceEvidence(input: PriceEvidenceInput): PriceEvidenceRecord {
  const record: PriceEvidenceRecord = {
    id: `pe-${randomUUID()}`,
    ...input,
    reviewStatus: "unreviewed",
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  ensureDatabase()
    .insert(priceEvidence)
    .values({
      id: record.id,
      category: record.category,
      productName: record.productName,
      priceCents: record.priceCents,
      priceBasis: record.priceBasis ?? null,
      sourceType: record.sourceType,
      platform: record.platform ?? null,
      shop: record.shop ?? null,
      condition: record.condition ?? null,
      canonicalProductId: record.canonicalProductId ?? null,
      region: record.region ?? null,
      reviewStatus: record.reviewStatus,
      evidenceUrl: record.evidenceUrl ?? null,
      note: record.note ?? null,
      capturedAt: record.capturedAt,
      createdAt: record.createdAt,
    })
    .run();
  return record;
}

export function listPriceEvidence(options: {
  q?: string;
  category?: string;
  canonicalProductId?: string;
  reviewStatus?: PriceReviewStatus;
  limit?: number;
}): PriceEvidenceRecord[] {
  const conditions = [
    options.category ? eq(priceEvidence.category, options.category) : undefined,
    options.canonicalProductId ? eq(priceEvidence.canonicalProductId, options.canonicalProductId) : undefined,
    options.reviewStatus ? eq(priceEvidence.reviewStatus, options.reviewStatus) : undefined,
    options.q ? like(priceEvidence.productName, `%${options.q}%`) : undefined,
  ].filter((condition) => condition !== undefined);

  return ensureDatabase()
    .select()
    .from(priceEvidence)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(priceEvidence.capturedAt))
    .limit(options.limit ?? 50)
    .all()
    .map(toRecord);
}

/** 价格审核结论（unreviewed → verified / rejected；rejected 为终态）：不改价格值，只改审核状态 */
export function reviewPriceEvidence(
  id: string,
  reviewStatus: Exclude<PriceReviewStatus, "unreviewed">,
): PriceEvidenceRecord {
  const db = ensureDatabase();
  const row = db.select().from(priceEvidence).where(eq(priceEvidence.id, id)).get();
  if (!row) throw new Error(`价格证据不存在：${id}`);
  if (row.reviewStatus === "rejected") {
    throw new Error("已驳回的价格证据为终态，不可变更");
  }
  db.update(priceEvidence).set({ reviewStatus }).where(eq(priceEvidence.id, id)).run();
  const updated = db.select().from(priceEvidence).where(eq(priceEvidence.id, id)).get();
  return toRecord(updated!);
}

/** 价格证据统计（发布门禁 Task 9 用）：带 canonicalId 绑定的比例、过期占比 */
export function priceEvidenceStats(options: { now?: string } = {}): {
  total: number;
  withCanonicalId: number;
  verified: number;
  rejected: number;
  olderThan90Days: number;
} {
  const row = ensureDatabase()
    .select({
      total: sql<number>`count(*)`,
      withCanonicalId: sql<number>`sum(case when canonical_product_id is not null then 1 else 0 end)`,
      verified: sql<number>`sum(case when review_status = 'verified' then 1 else 0 end)`,
      rejected: sql<number>`sum(case when review_status = 'rejected' then 1 else 0 end)`,
      olderThan90Days: sql<number>`sum(case when captured_at < datetime('now', '-90 days') then 1 else 0 end)`,
    })
    .from(priceEvidence)
    .get();
  void options;
  return {
    total: row?.total ?? 0,
    withCanonicalId: row?.withCanonicalId ?? 0,
    verified: row?.verified ?? 0,
    rejected: row?.rejected ?? 0,
    olderThan90Days: row?.olderThan90Days ?? 0,
  };
}
