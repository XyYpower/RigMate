import { NextResponse } from "next/server";
import { getDesignResult } from "@/application/design/service";
import { listAgentEventLog } from "@/infra/db/repositories/agent-event-log-repository";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const result = getDesignResult(id);
  if (!result) return NextResponse.json({ error: "找不到该方案请求。" }, { status: 404 });
  // events：会话富事件日志（agent-ui P2），时间线视图的引导数据；result.run.events 为旧模型并存
  return NextResponse.json({ result, events: listAgentEventLog(id) });
}
