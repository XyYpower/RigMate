import { NextResponse } from "next/server";
import { priceEvidenceInputSchema } from "@/domain/price/evidence";
import {
  addPriceEvidence,
  listPriceEvidence,
} from "@/infra/db/repositories/price-evidence-repository";

/** 价格证据（规格 §8.2）：GET 列表（最近优先，可按类别/关键词过滤）；POST 追加一条（V1 仅手动来源） */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 50, 1), 200) : 50;
  return NextResponse.json({ evidence: listPriceEvidence({ category, q, limit }) });
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
