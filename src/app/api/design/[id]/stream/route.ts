import { NextResponse } from "next/server";
import { findDesignRequest } from "@/infra/db/repositories/design-repository";
import { createDesignEventStream } from "@/application/design/event-stream";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * 会话事件流（agent-ui P1）：GET /api/design/[id]/stream
 * SSE 按序吐出富事件；Last-Event-ID 头（= seq）断线续传；run_completed 后终结。
 */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!findDesignRequest(id)) {
    return NextResponse.json({ error: "找不到该方案请求。" }, { status: 404 });
  }
  const afterSeqHeader = request.headers.get("last-event-id");
  const afterSeq = afterSeqHeader !== null ? Number.parseInt(afterSeqHeader, 10) : 0;
  const stream = createDesignEventStream(id, {
    afterSeq: Number.isFinite(afterSeq) && afterSeq > 0 ? afterSeq : 0,
    signal: request.signal,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
