import { NextResponse } from "next/server";
import { getDesignResult } from "@/application/design/service";
import { findDesignRequest } from "@/infra/db/repositories/design-repository";
import { listAgentEventLog } from "@/infra/db/repositories/agent-event-log-repository";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const result = getDesignResult(id);
  const request = result?.request ?? findDesignRequest(id);
  if (!request) return NextResponse.json({ error: "找不到该方案请求。" }, { status: 404 });
  // 生成进行中（run 未落库）返回部分快照：request + 富事件流，result 为 null——
  // 会话页据此实时点亮时间线，方案实体等 proposal 事件后再补拉
  return NextResponse.json({ result, request, events: listAgentEventLog(id) });
}
