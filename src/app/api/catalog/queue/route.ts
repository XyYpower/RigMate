import { NextResponse } from "next/server";
import { pendingCatalogItemSchema } from "@/contracts/catalog";
import { createCatalogQueueItem, listCatalogQueue } from "@/application/catalog-review/service";

/** 目录审核队列：GET 列表（可按状态/类型过滤）；POST 新建队列项（new_product / missing_field / conflict / stale） */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const queueType = url.searchParams.get("queueType");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 100, 1), 500) : 100;
  const parsedStatus = status ? pendingCatalogItemSchema.shape.status.safeParse(status) : null;
  const parsedType = queueType ? pendingCatalogItemSchema.shape.queueType.safeParse(queueType) : null;
  if (status && !parsedStatus?.success) {
    return NextResponse.json({ error: `非法的队列状态：${status}` }, { status: 400 });
  }
  if (queueType && !parsedType?.success) {
    return NextResponse.json({ error: `非法的队列类型：${queueType}` }, { status: 400 });
  }
  return NextResponse.json({
    items: listCatalogQueue({
      status: parsedStatus?.success ? parsedStatus.data : undefined,
      queueType: parsedType?.success ? parsedType.data : undefined,
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
  const parsed = pendingCatalogItemSchema
    .omit({ id: true, createdAt: true, updatedAt: true, resolvedAt: true, status: true, assignedTo: true, resolutionNote: true })
    .safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `队列项信息不完整：${first?.path.join(".")} ${first?.message}` },
      { status: 400 },
    );
  }
  try {
    const item = createCatalogQueueItem(parsed.data);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
