import { NextResponse } from "next/server";
import { listDesignRequests } from "@/infra/db/repositories/design-repository";
import { listAgentEventLog } from "@/infra/db/repositories/agent-event-log-repository";
import { percentile, summarizeRequestEvents } from "@/application/agent/run-metrics";

/**
 * 运行诊断（Phase 5，launch-readiness §10.3）：最近会话 × 每 run 指标摘要 + 聚合。
 * 只读：数据全部来自已落库的 agent_event_log，无写路径。
 */
export async function GET() {
  const sessions = listDesignRequests(20).map((session) => ({
    id: session.id,
    rawInput: session.rawInput,
    status: session.status,
    updatedAt: session.updatedAt,
    runs: summarizeRequestEvents(listAgentEventLog(session.id)),
  }));

  const runs = sessions.flatMap((session) => session.runs);
  const totalMsValues = runs
    .map((run) => run.totalMs)
    .filter((ms): ms is number => ms !== null);
  const adviceRuns = runs.filter((run) => run.adviceMs !== null);
  const selectionRuns = runs.filter((run) => run.selectionMs !== null);

  const aggregate = {
    sessionCount: sessions.length,
    runCount: runs.length,
    p50Ms: percentile(totalMsValues, 50),
    p95Ms: percentile(totalMsValues, 95),
    fallbackRate: runs.length > 0 ? runs.filter((run) => run.fallbackCount > 0).length / runs.length : null,
    adviceAvgMs:
      adviceRuns.length > 0
        ? Math.round(adviceRuns.reduce((sum, run) => sum + (run.adviceMs ?? 0), 0) / adviceRuns.length)
        : null,
    selectionAvgMs:
      selectionRuns.length > 0
        ? Math.round(selectionRuns.reduce((sum, run) => sum + (run.selectionMs ?? 0), 0) / selectionRuns.length)
        : null,
  };

  return NextResponse.json({ aggregate, sessions });
}
