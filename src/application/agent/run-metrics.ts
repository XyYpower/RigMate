import type { RigEnvelope } from "@/contracts/agent-events";

/**
 * Run 指标聚合器（Phase 5，launch-readiness §10.3：每个 AgentRun 有
 * prompt/model/latency/fallback 摘要）。纯函数：只吃已落库的富事件，
 * 不读库、不发请求——诊断 API 与页面共用同一份口径。
 */

export type RunToolMetric = {
  tool: string;
  calls: number;
  totalMs: number;
  errors: number;
};

export type RunMetrics = {
  runId: string;
  requestId: string;
  model: string | null;
  promptVersion: string | null;
  /** run_started → run_completed；run 未结束（进行中/崩溃）为 null */
  totalMs: number | null;
  /** 携带 fallback 的异常数（模型路径回退到规则） */
  fallbackCount: number;
  anomalyCount: number;
  tools: RunToolMetric[];
  /** 关键分项：选件 / 修订 / 建议 的累计耗时（无调用为 null） */
  selectionMs: number | null;
  revisionMs: number | null;
  adviceMs: number | null;
  questionCount: number;
  answerCount: number;
  revisionMergedCount: number;
  completedStatus: string | null;
};

function durationMs(startedAt: string | null | undefined, finishedAt: string | null | undefined): number | null {
  if (!startedAt || !finishedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function emptyMetrics(runId: string, requestId: string): RunMetrics {
  return {
    runId,
    requestId,
    model: null,
    promptVersion: null,
    totalMs: null,
    fallbackCount: 0,
    anomalyCount: 0,
    tools: [],
    selectionMs: null,
    revisionMs: null,
    adviceMs: null,
    questionCount: 0,
    answerCount: 0,
    revisionMergedCount: 0,
    completedStatus: null,
  };
}

/** 把一个 request 的富事件按 runId 分组，产出每个 run 的指标摘要（seq 升序输入） */
export function summarizeRequestEvents(envelopes: RigEnvelope[]): RunMetrics[] {
  const byRun = new Map<string, RunMetrics>();
  const startedAtByRun = new Map<string, string>();

  for (const envelope of envelopes) {
    const runId = envelope.runId;
    let metrics = byRun.get(runId);
    if (!metrics) {
      metrics = emptyMetrics(runId, envelope.requestId);
      byRun.set(runId, metrics);
    }
    const payload = envelope.payload;
    switch (payload.type) {
      case "run_started":
        metrics.model = payload.model;
        metrics.promptVersion = payload.promptVersion;
        startedAtByRun.set(runId, envelope.at);
        break;
      case "run_completed": {
        metrics.completedStatus = payload.status;
        const startedAt = startedAtByRun.get(runId);
        if (startedAt !== undefined) {
          const start = Date.parse(startedAt);
          const end = Date.parse(envelope.at);
          if (Number.isFinite(start) && Number.isFinite(end) && end >= start) metrics.totalMs = end - start;
        }
        break;
      }
      case "tool_call": {
        const ms = durationMs(payload.startedAt, payload.finishedAt);
        let tool = metrics.tools.find((entry) => entry.tool === payload.tool);
        if (!tool) {
          tool = { tool: payload.tool, calls: 0, totalMs: 0, errors: 0 };
          metrics.tools.push(tool);
        }
        if (payload.state !== "running") {
          tool.calls += 1;
          if (payload.state === "error") tool.errors += 1;
          if (ms !== null) tool.totalMs += ms;
          if (payload.tool === "select_catalog_candidates" && ms !== null) {
            metrics.selectionMs = (metrics.selectionMs ?? 0) + ms;
          }
          if (payload.tool === "revise_intent" && ms !== null) {
            metrics.revisionMs = (metrics.revisionMs ?? 0) + ms;
          }
          if (payload.tool === "generate_advice" && ms !== null) {
            metrics.adviceMs = (metrics.adviceMs ?? 0) + ms;
          }
        }
        break;
      }
      case "anomaly":
        metrics.anomalyCount += 1;
        if (payload.fallback) metrics.fallbackCount += 1;
        break;
      case "question":
        metrics.questionCount += 1;
        break;
      case "answer":
        metrics.answerCount += 1;
        break;
      case "revision_merged":
        metrics.revisionMergedCount += 1;
        break;
      default:
        break;
    }
  }

  return [...byRun.values()];
}

/** 百分位（升序样本；最近端插值）：诊断聚合用 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return Math.round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower));
}
