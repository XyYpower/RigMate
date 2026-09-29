import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CatalogReviewError,
  addReviewEvidence,
  addReviewSource,
  getReviewContext,
  markProductStale,
  mergeProducts,
  publishProduct,
  reviewSourceStatus,
  verifyReviewEvidence,
} from "@/application/catalog-review/service";
import { evidenceStatusSchema } from "@/domain/catalog/quality";
import { productSourceTypeSchema, productFieldEvidenceSchema } from "@/contracts/catalog";
import { listPendingReviewItems } from "@/infra/db/repositories/evidence-repository";

/**
 * 目录审核 API（Task 4）：人工审核的唯一入口。
 * 纪律：所有写操作 body 必须带 reviewer；产品质量状态只能经 publish 按证据链重算落库。
 */

const addSourceAction = z.object({
  action: z.literal("add_source"),
  canonicalProductId: z.string().trim().min(1),
  sourceType: productSourceTypeSchema,
  tier: z.enum(["S1", "S2", "S3", "S4"]),
  sourceUrl: z.string().trim().url().max(500),
  sourceTitle: z.string().trim().min(1).max(300),
  sourceVersion: z.string().trim().max(120).nullable().optional(),
  license: z.string().trim().max(120).nullable().optional(),
  contentHash: z.string().trim().min(8).max(128),
  reviewer: z.string().trim().min(1).max(80),
});

const addEvidenceAction = z.object({
  action: z.literal("add_evidence"),
  canonicalProductId: z.string().trim().min(1),
  fieldPath: z.string().trim().regex(/^spec\.[A-Za-z][A-Za-z0-9_]*$/),
  sourceId: z.string().trim().min(1),
  value: z.unknown(),
  excerpt: z.string().trim().min(1).max(600),
  identityMatch: productFieldEvidenceSchema.shape.identityMatch,
  confidence: productFieldEvidenceSchema.shape.confidence.optional(),
  reviewer: z.string().trim().min(1).max(80),
});

const verifyEvidenceAction = z.object({
  action: z.literal("verify_evidence"),
  evidenceId: z.string().trim().min(1),
  reviewer: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional(),
});

const reviewSourceAction = z.object({
  action: z.literal("review_source"),
  sourceId: z.string().trim().min(1),
  status: evidenceStatusSchema.exclude(["unreviewed"]),
  reviewer: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional(),
});

const markStaleAction = z.object({
  action: z.literal("mark_stale"),
  canonicalProductId: z.string().trim().min(1),
  reviewer: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(500),
});

const publishAction = z.object({
  action: z.literal("publish"),
  canonicalProductId: z.string().trim().min(1),
  reviewer: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional(),
});

const mergeAction = z.object({
  action: z.literal("merge"),
  keepId: z.string().trim().min(1),
  duplicateId: z.string().trim().min(1),
  reviewer: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(500),
});

const actionSchema = z.discriminatedUnion("action", [
  addSourceAction,
  addEvidenceAction,
  verifyEvidenceAction,
  reviewSourceAction,
  markStaleAction,
  publishAction,
  mergeAction,
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  // 不带 productId = 审核台模式：返回全部待人工复核的字段证据（按产品分组）
  if (!productId) {
    const items = listPendingReviewItems();
    const byProduct = new Map<string, { productId: string; productName: string; productCategory: string; evidence: typeof items }>();
    for (const item of items) {
      let bucket = byProduct.get(item.productId);
      if (!bucket) {
        bucket = { productId: item.productId, productName: item.productName, productCategory: item.productCategory, evidence: [] };
        byProduct.set(item.productId, bucket);
      }
      bucket.evidence.push(item);
    }
    return NextResponse.json({ total: items.length, products: [...byProduct.values()] });
  }
  try {
    return NextResponse.json(getReviewContext(productId));
  } catch (error) {
    if (error instanceof CatalogReviewError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `审核操作不合法：${first?.path.join(".")} ${first?.message}` },
      { status: 400 },
    );
  }
  try {
    const action = parsed.data;
    switch (action.action) {
      case "add_source": {
        const source = addReviewSource(action);
        return NextResponse.json({ source }, { status: 201 });
      }
      case "add_evidence": {
        const result = addReviewEvidence(action);
        return NextResponse.json({ evidence: result.evidence, field: result.field }, { status: 201 });
      }
      case "verify_evidence":
        return NextResponse.json({ report: verifyReviewEvidence(action) });
      case "review_source":
        return NextResponse.json({ report: reviewSourceStatus(action) });
      case "mark_stale":
        return NextResponse.json({ report: markProductStale(action) });
      case "publish":
        return NextResponse.json({ report: publishProduct(action) });
      case "merge":
        return NextResponse.json({ report: mergeProducts(action) });
    }
  } catch (error) {
    if (error instanceof CatalogReviewError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
