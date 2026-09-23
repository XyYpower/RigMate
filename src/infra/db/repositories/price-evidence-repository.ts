import { randomUUID } from "node:crypto";
import { and, desc, eq, like } from "drizzle-orm";
import { priceEvidence, ensureDatabase } from "../client";
import type { PriceEvidenceInput, PriceEvidenceRecord } from "@/domain/price/evidence";

/**
 * price_evidence 仓储（规格 §8.2）：**追加式**——只有插入与查询，
 * 不提供修改/删除接口；旧证据永远保留，价格判断由消费方按时间取用。
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
  limit?: number;
}): PriceEvidenceRecord[] {
  const conditions = [
    options.category ? eq(priceEvidence.category, options.category) : undefined,
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
