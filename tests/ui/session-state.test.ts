import { describe, expect, it } from "vitest";
import type { RigEnvelope, RigEvent } from "@/contracts/agent-events";
import {
  applyEnvelope,
  hydrateSnapshot,
  initialSessionState,
  type SessionSnapshot,
} from "@/ui/session/session-state";

// 会话状态投影回归（agent-ui P2）：seq 幂等去重、时间线折叠、快照引导补缺口。

const REQUEST_ID = "req-1";
const RUN_ID = "run-1";

function envelope(seq: number, payload: RigEvent): RigEnvelope {
  return { id: `evt-${seq}`, seq, requestId: REQUEST_ID, runId: RUN_ID, at: "2026-10-13T08:00:00.000Z", payload };
}

function replay(payloads: RigEvent[]): ReturnType<typeof applyAll> {
  return applyAll(payloads.map((payload, index) => envelope(index + 1, payload)));
}

function applyAll(envelopes: RigEnvelope[]) {
  let state = initialSessionState();
  for (const item of envelopes) state = applyEnvelope(state, item);
  return state;
}

describe("会话状态投影（session-state）", () => {
  it("按 seq 幂等折叠：重复投递不产生重复条目", () => {
    let state = initialSessionState();
    const message = envelope(1, { type: "user_message", runId: RUN_ID, text: "两万预算" });
    state = applyEnvelope(state, message);
    state = applyEnvelope(state, message);
    state = applyEnvelope(state, message);
    expect(state.timeline).toHaveLength(1);
    expect(state.lastSeq).toBe(1);
    expect(state.log).toHaveLength(1);
  });

  it("事件折叠为时间线条目；run_completed 只推进状态不进时间线", () => {
    const state = replay([
      { type: "user_message", runId: RUN_ID, text: "两万预算" },
      { type: "run_started", runId: RUN_ID, model: "glm-5.3", promptVersion: "selection-v1" },
      { type: "phase", runId: RUN_ID, phase: "understanding", message: "已理解目标" },
      { type: "tool_call", runId: RUN_ID, tool: "searchCatalog", state: "done", detail: "已检索 cpu：命中 8 个候选。", resultIds: ["cpu-1"], startedAt: "t", finishedAt: "t" },
      { type: "question", runId: RUN_ID, message: "还缺少预算" },
      { type: "run_completed", runId: RUN_ID, status: "ok" },
    ]);
    expect(state.timeline.map((item) => item.kind)).toEqual([
      "user",
      "run_started",
      "phase",
      "tool",
      "question",
    ]);
    expect(state.runStatus).toBe("completed");
    expect(state.question).toBe("还缺少预算");
    expect(state.status).toBe("ready");
  });

  it("run_started 计轮：第 N 轮由 run_started 出现次数决定", () => {
    const state = replay([
      { type: "run_started", runId: RUN_ID, model: "rule-engine", promptVersion: "v1" },
      { type: "run_completed", runId: RUN_ID, status: "ok" },
      { type: "run_started", runId: RUN_ID, model: "rule-engine", promptVersion: "v1" },
    ]);
    const runItems = state.timeline.filter((item) => item.kind === "run_started");
    expect(runItems.map((item) => (item.kind === "run_started" ? item.runNumber : -1))).toEqual([1, 2]);
  });

  it("快照引导：重放快照事件并保留快照缺口之外的实时事件", () => {
    const before = replay([
      { type: "user_message", runId: RUN_ID, text: "两万预算" },
      { type: "phase", runId: RUN_ID, phase: "understanding", message: "已理解目标" },
    ]);
    // 快照只含第 1 条（读取时第 2 条尚未落库的竞态）；result 为 GET wire 契约（versions 字段）
    const snapshot: SessionSnapshot = {
      result: {
        request: {
          id: REQUEST_ID,
          rawInput: "两万预算",
          intent: { budgetCents: null, useCases: [], appearance: [], existingParts: [], constraints: [], region: "中国大陆" },
          status: "generating",
          createdAt: "2026-10-13T08:00:00.000Z",
          updatedAt: "2026-10-13T08:00:00.000Z",
        },
        proposal: null,
        run: {
          id: "run-snapshot",
          requestId: REQUEST_ID,
          proposalId: null,
          status: "running",
          createdAt: "2026-10-13T08:00:00.000Z",
          completedAt: null,
          events: [],
        },
        changes: [],
        versions: [],
      },
      events: [envelope(1, { type: "user_message", runId: RUN_ID, text: "两万预算" })],
    };
    const hydrated = hydrateSnapshot(before, snapshot);
    expect(hydrated.timeline.map((item) => item.kind)).toEqual(["user", "phase"]);
    expect(hydrated.request?.id).toBe(REQUEST_ID);
    expect(hydrated.lastSeq).toBe(2);
    expect(hydrated.log.map((entry) => entry.seq)).toEqual([1, 2]);
  });

  it("anomaly 事件保留 errorCode 与 fallback", () => {
    const state = replay([
      {
        type: "anomaly",
        runId: RUN_ID,
        message: "模型选件不可用",
        errorCode: "MODEL_FALLBACK",
        fallback: { reason: "模型服务返回 429", from: "glm-5.3", to: "rule-engine" },
      },
    ]);
    expect(state.timeline).toHaveLength(1);
    const item = state.timeline[0]!;
    expect(item.kind).toBe("anomaly");
    if (item.kind === "anomaly") {
      expect(item.errorCode).toBe("MODEL_FALLBACK");
      expect(item.fallback?.to).toBe("rule-engine");
    }
  });
});
