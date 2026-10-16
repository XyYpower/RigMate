import { describe, expect, it } from "vitest";
import { summarizeRequestEvents, type RunMetrics } from "@/application/agent/run-metrics";
import type { RigEnvelope, RigEvent } from "@/contracts/agent-events";

// Phase 5 观测（launch-readiness §10.3）：每个 run 有 prompt/model/latency/fallback 摘要。
// 聚合器是纯函数：只吃已落库的富事件，不读库不发请求。

const REQUEST_ID = "req-obs-1";

let seq = 0;
function envelope(at: string, payload: RigEvent): RigEnvelope {
  seq += 1;
  return { id: `evt-${seq}`, seq, requestId: REQUEST_ID, runId: payload.runId, at, payload };
}

describe("summarizeRequestEvents（run 指标聚合）", () => {
  const events: RigEnvelope[] = [
    envelope("2026-10-15T08:00:00.000Z", { type: "user_message", runId: "run-1", text: "预算 1.5 万打 3A" }),
    envelope("2026-10-15T08:00:01.000Z", { type: "run_started", runId: "run-1", model: "glm-5.3-flash", promptVersion: "intent-v1" }),
    envelope("2026-10-15T08:00:02.000Z", { type: "tool_call", runId: "run-1", tool: "parse_intent", state: "running", detail: "", resultIds: [], startedAt: "2026-10-15T08:00:02.000Z", finishedAt: null }),
    envelope("2026-10-15T08:00:04.000Z", { type: "tool_call", runId: "run-1", tool: "parse_intent", state: "done", detail: "", resultIds: [], startedAt: "2026-10-15T08:00:02.000Z", finishedAt: "2026-10-15T08:00:04.000Z" }),
    envelope("2026-10-15T08:00:05.000Z", { type: "tool_call", runId: "run-1", tool: "searchCatalog", state: "done", detail: "", resultIds: [], startedAt: "2026-10-15T08:00:04.500Z", finishedAt: "2026-10-15T08:00:05.000Z" }),
    envelope("2026-10-15T08:00:06.000Z", { type: "tool_call", runId: "run-1", tool: "select_catalog_candidates", state: "done", detail: "", resultIds: [], startedAt: "2026-10-15T08:00:05.000Z", finishedAt: "2026-10-15T08:00:06.000Z" }),
    envelope("2026-10-15T08:00:07.000Z", { type: "phase", runId: "run-1", phase: "validated", message: "兼容检查完成" }),
    envelope("2026-10-15T08:00:08.000Z", { type: "proposal", runId: "run-1", proposalId: "p-1", version: 1, title: "方案" }),
    envelope("2026-10-15T08:00:09.000Z", { type: "tool_call", runId: "run-1", tool: "generate_advice", state: "done", detail: "", resultIds: [], startedAt: "2026-10-15T08:00:08.000Z", finishedAt: "2026-10-15T08:00:09.000Z" }),
    envelope("2026-10-15T08:00:10.000Z", { type: "run_completed", runId: "run-1", status: "ok" }),
  ];

  it("单 run：总时长、模型、每工具时长与调用数、advice 分项", () => {
    const [metrics] = summarizeRequestEvents(events);
    expect(metrics).toBeDefined();
    const m = metrics as RunMetrics;
    expect(m.runId).toBe("run-1");
    expect(m.model).toBe("glm-5.3-flash");
    expect(m.promptVersion).toBe("intent-v1");
    // run_started 08:00:01 → run_completed 08:00:10
    expect(m.totalMs).toBe(9000);
    expect(m.fallbackCount).toBe(0);
    expect(m.anomalyCount).toBe(0);
    const parseIntent = m.tools.find((tool) => tool.tool === "parse_intent");
    expect(parseIntent).toMatchObject({ calls: 1, totalMs: 2000, errors: 0 });
    expect(m.selectionMs).toBe(1000);
    expect(m.adviceMs).toBe(1000);
    expect(m.revisionMs).toBeNull();
  });

  it("多 run 分组：修订 run 单独成行，answer/question 计数", () => {
    const events2: RigEnvelope[] = [
      ...events,
      envelope("2026-10-15T08:05:00.000Z", { type: "user_message", runId: "run-2", text: "为什么选这个显卡？" }),
      envelope("2026-10-15T08:05:01.000Z", { type: "run_started", runId: "run-2", model: "glm-5.3-flash", promptVersion: "revision-v1" }),
      envelope("2026-10-15T08:05:02.000Z", { type: "answer", runId: "run-2", summary: "【显卡】…", actions: [] }),
      envelope("2026-10-15T08:05:03.000Z", { type: "revision_merged", runId: "run-2", instruction: "预算压到 8 千", beforeIntent: {}, modelIntent: {}, mergedIntent: {}, changedFields: [], rejectedFields: [] }),
      envelope("2026-10-15T08:05:04.000Z", { type: "run_completed", runId: "run-2", status: "needs_input" }),
    ];
    const runs = summarizeRequestEvents(events2);
    expect(runs).toHaveLength(2);
    const run2 = runs.find((run) => run.runId === "run-2");
    expect(run2?.totalMs).toBe(3000);
    expect(run2?.answerCount).toBe(1);
    expect(run2?.revisionMergedCount).toBe(1);
    expect(run2?.questionCount).toBe(0);
  });

  it("回退与异常计数；无 run_completed 时 totalMs=null", () => {
    const events3: RigEnvelope[] = [
      envelope("2026-10-15T08:10:00.000Z", { type: "run_started", runId: "run-3", model: "glm-5.3-flash", promptVersion: "selection-v1" }),
      envelope("2026-10-15T08:10:01.000Z", {
        type: "anomaly", runId: "run-3",
        message: "模型超时回退",
        fallback: { reason: "模型请求超时", from: "glm-5.3-flash", to: "rule-engine" },
      }),
      envelope("2026-10-15T08:10:02.000Z", { type: "anomaly", runId: "run-3", message: "池空" }),
    ];
    const [metrics] = summarizeRequestEvents(events3);
    expect(metrics?.fallbackCount).toBe(1);
    expect(metrics?.anomalyCount).toBe(2);
    expect(metrics?.totalMs).toBeNull();
  });

  it("空事件 → 空数组", () => {
    expect(summarizeRequestEvents([])).toEqual([]);
  });
});
