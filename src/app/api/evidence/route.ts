import { NextResponse } from "next/server";
import { z } from "zod";
import { priceEvidenceInputSchema, priceReviewStatusSchema } from "@/domain/price/evidence";
import {
  addPriceEvidence,
  listPriceEvidence,
  reviewPriceEvidence,
} from "@/infra/db/repositories/price-evidence-repository";

/** 价格证据（规格 §8.2 + Task 8）：GET 列表（最近优先，可按类别/关键词/审核状态过滤）；POST 追加一条（V1 仅手动来源）；PATCH 审核结论 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const canonicalProductId = url.searchParams.get("canonicalProductId") ?? undefined;
  const reviewStatusRaw = url.searchParams.get("reviewStatus") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 50, 1), 200) : 50;
  const reviewStatus = reviewStatusRaw
    ? priceReviewStatusSchema.safeParse(reviewStatusRaw)
    : null;
  if (reviewStatusRaw && !reviewStatus?.success) {
    return NextResponse.json({ error: `非法的价格审核状态：${reviewStatusRaw}` }, { status: 400 });
  }
  return NextResponse.json({
    evidence: listPriceEvidence({
      category,
      q,
      canonicalProductId,
      reviewStatus: reviewStatus?.success ? reviewStatus.data : undefined,
      limit,
    }),
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }
  const parsed = priceEvidenceInputSchema.safeParse({
    ...(body as Record<string, unknown>),
    sourceType: "manual_entry",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `证据信息不完整：${first?.path.join(".")} ${first?.message}` },
      { status: 400 },
    );
  }
  const record = addPriceEvidence(parsed.data);
  return NextResponse.json({ evidence: record }, { status: 201 });
}

const reviewPatchSchema = z.object({
  id: z.string().trim().min(1),
  reviewStatus: priceReviewStatusSchema.exclude(["unreviewed"]),
});

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }
  const parsed = reviewPatchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `审核请求不合法：${first?.path.join(".")} ${first?.message}` },
      { status: 400 },
    );
  }
  try {
    const record = reviewPriceEvidence(parsed.data.id, parsed.data.reviewStatus);
    return NextResponse.json({ evidence: record });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
