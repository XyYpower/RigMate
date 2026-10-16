import { listDesignRequests } from "@/infra/db/repositories/design-repository";
import { listAgentEventLog } from "@/infra/db/repositories/agent-event-log-repository";
import { percentile, summarizeRequestEvents, type RunMetrics } from "@/application/agent/run-metrics";
import { WorkspaceHeader } from "@/ui/workbench/workspace-header";

/**
 * 运行诊断页（Phase 5，launch-readiness §10.3）：最近会话 × run 指标 + 聚合。
 * 只读管理页，不进新手主流程；数据口径与 GET /api/diagnostics 完全一致。
 */

type SessionRow = {
  id: string;
  rawInput: string;
  status: string;
  updatedAt: string;
  runs: RunMetrics[];
};

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function ToolCell({ run }: { run: RunMetrics }) {
  const parts = run.tools
    .filter((tool) => tool.calls > 0)
    .map((tool) => `${tool.tool} ${formatMs(tool.totalMs)}${tool.errors > 0 ? `（错 ${tool.errors}）` : ""}`);
  return <>{parts.join(" · ") || "—"}</>;
}

export default function DiagnosticsPage() {
  const sessions: SessionRow[] = listDesignRequests(20).map((session) => ({
    id: session.id,
    rawInput: session.rawInput,
    status: session.status,
    updatedAt: session.updatedAt,
    runs: summarizeRequestEvents(listAgentEventLog(session.id)),
  }));
  const runs = sessions.flatMap((session) => session.runs);
  const totalMsValues = runs.map((run) => run.totalMs).filter((ms): ms is number => ms !== null);
  const fallbackRuns = runs.filter((run) => run.fallbackCount > 0).length;
  const adviceRuns = runs.filter((run) => run.adviceMs !== null);
  const selectionRuns = runs.filter((run) => run.selectionMs !== null);

  return (
    <main className="diagnostics-page">
      <WorkspaceHeader
        title="运行诊断"
        summary="最近 20 个会话的模型运行指标：延迟、回退、分项耗时（数据来自事件日志，只读）"
      />

      <section className="wb-panel diagnostics-aggregate" aria-label="聚合指标">
        <div>
          <span>会话 / 运行</span>
          <strong className="mono">{sessions.length} / {runs.length}</strong>
        </div>
        <div>
          <span>整轮延迟 P50 / P95</span>
          <strong className="mono">{formatMs(percentile(totalMsValues, 50))} / {formatMs(percentile(totalMsValues, 95))}</strong>
        </div>
        <div>
          <span>模型回退率</span>
          <strong className="mono">{runs.length > 0 ? `${Math.round((fallbackRuns / runs.length) * 100)}%` : "—"}</strong>
        </div>
        <div>
          <span>选件平均</span>
          <strong className="mono">
            {selectionRuns.length > 0
              ? formatMs(Math.round(selectionRuns.reduce((sum, run) => sum + (run.selectionMs ?? 0), 0) / selectionRuns.length))
              : "—"}
          </strong>
        </div>
        <div>
          <span>建议平均</span>
          <strong className="mono">
            {adviceRuns.length > 0
              ? formatMs(Math.round(adviceRuns.reduce((sum, run) => sum + (run.adviceMs ?? 0), 0) / adviceRuns.length))
              : "—"}
          </strong>
        </div>
      </section>

      <section className="wb-panel diagnostics-sessions" aria-label="会话运行明细">
        <h2>会话 × 运行明细</h2>
        {sessions.length === 0 && <p className="diagnostics-empty">还没有任何会话。</p>}
        <ul className="diagnostics-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <p className="diagnostics-session-head">
                <strong>{session.rawInput.slice(0, 40)}</strong>
                <span className="mono">{session.status} · {session.updatedAt.slice(0, 16).replace("T", " ")}</span>
              </p>
              {session.runs.length === 0 && <p className="diagnostics-empty">无运行记录。</p>}
              <ul>
                {session.runs.map((run) => (
                  <li key={run.runId} className="diagnostics-run">
                    <span className="mono">
                      {formatMs(run.totalMs)} · {run.model ?? "—"} · {run.promptVersion ?? "—"} · 完成 {run.completedStatus ?? "—"}
                      {run.fallbackCount > 0 ? ` · 回退 ${run.fallbackCount}` : ""}
                      {run.anomalyCount > 0 ? ` · 异常 ${run.anomalyCount}` : ""}
                    </span>
                    <span className="diagnostics-tools"><ToolCell run={run} /></span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
