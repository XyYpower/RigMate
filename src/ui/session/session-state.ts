import type { RigEnvelope } from "@/contracts/agent-events";
import type { DesignProposal, DesignRequest, DesignResult, ProposalChange } from "@/contracts/design";

/**
 * 会话状态投影（agent-ui-design §5.1，P2）。
 *
 * UI = 事件流的纯函数投影（借鉴 ZCode EventReducer）：applyEnvelope 只追加、
 * 按 seq 去重，任何来源（快照回放 / SSE 实时 / 重连续传）重复投递都幂等。
 * hydrateSnapshot 用快照重放引导并保留快照缺口之外的实时事件（竞态安全）。
 */

export type TimelineItem =
  | { kind: "run_started"; seq: number; runNumber: number; model: string; at: string }
  | { kind: "user"; seq: number; text: string; at: string }
  | { kind: "phase"; seq: number; phase: string; message: string; at: string }
  | {
      kind: "tool";
      seq: number;
      tool: string;
      state: "running" | "done" | "error";
      detail: string;
      resultIds: string[];
      at: string;
    }
  | {
      kind: "anomaly";
      seq: number;
      message: string;
      errorCode?: string;
      fallback?: { reason: string; from: string; to: string };
      at: string;
    }
  | { kind: "question"; seq: number; message: string; at: string }
  | { kind: "proposal"; seq: number; proposalId: string; version: number; title: string; at: string };

export type SessionRunStatus = "idle" | "running" | "completed";

export type SessionState = {
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
  request: DesignRequest | null;
  /** 快照携带的全部版本方案（proposal 事件只带 id/version/title，卡片渲染时按 id 查这里） */
  proposals: DesignProposal[];
  /** 最新方案相对上一版的差异（快照 result.changes） */
  changes: ProposalChange[];
  /** 已应用的原始事件（按 seq 升序）；hydrate 时用于补齐快照缺口 */
  log: RigEnvelope[];
  timeline: TimelineItem[];
  lastSeq: number;
  runStatus: SessionRunStatus;
  /** 最近一条追问（needs_input / 无法理解修订等） */
  question: string | null;
};

export function initialSessionState(): SessionState {
  return {
    status: "loading",
    errorMessage: null,
    request: null,
    proposals: [],
    changes: [],
    log: [],
    timeline: [],
    lastSeq: 0,
    runStatus: "idle",
    question: null,
  };
}

/** 单条事件折叠进状态：seq 去重（幂等），其余只追加 */
export function applyEnvelope(state: SessionState, envelope: RigEnvelope): SessionState {
  if (envelope.seq <= state.lastSeq) return state;
  const payload = envelope.payload;
  const at = envelope.at;
  let item: TimelineItem | null = null;
  switch (payload.type) {
    case "run_started":
      item = {
        kind: "run_started",
        seq: envelope.seq,
        runNumber: state.timeline.filter((entry) => entry.kind === "run_started").length + 1,
        model: payload.model,
        at,
      };
      break;
    case "user_message":
      item = { kind: "user", seq: envelope.seq, text: payload.text, at };
      break;
    case "phase":
      item = { kind: "phase", seq: envelope.seq, phase: payload.phase, message: payload.message, at };
      break;
    case "tool_call":
      item = {
        kind: "tool",
        seq: envelope.seq,
        tool: payload.tool,
        state: payload.state,
        detail: payload.detail,
        // 同一事件里同名工具的批量留痕可能有重复 id（如多候选共享证据来源），去重保稳定 key
        resultIds: [...new Set(payload.resultIds)],
        at,
      };
      break;
    case "anomaly":
      item = {
        kind: "anomaly",
        seq: envelope.seq,
        message: payload.message,
        ...(payload.errorCode ? { errorCode: payload.errorCode } : {}),
        ...(payload.fallback ? { fallback: payload.fallback } : {}),
        at,
      };
      break;
    case "question":
      item = { kind: "question", seq: envelope.seq, message: payload.message, at };
      break;
    case "proposal":
      item = {
        kind: "proposal",
        seq: envelope.seq,
        proposalId: payload.proposalId,
        version: payload.version,
        title: payload.title,
        at,
      };
      break;
    case "run_completed":
      // 终态不进时间线（追问/方案卡已承载结果），只推进 runStatus
      break;
  }
  return {
    ...state,
    status: "ready",
    errorMessage: null,
    log: [...state.log, envelope],
    lastSeq: envelope.seq,
    timeline: item ? [...state.timeline, item] : state.timeline,
    runStatus: payload.type === "run_completed" ? "completed" : "running",
    question: payload.type === "question" ? payload.message : state.question,
  };
}

export type SessionSnapshot = {
  /** GET /api/design/[id] 的 result（wire 契约：request / proposal / run / changes / versions） */
  result: DesignResult;
  events: RigEnvelope[];
};

/** 快照引导：重放事件流 + 挂快照实体；重放后补投本地已有而快照未含的实时事件（竞态安全） */
export function hydrateSnapshot(previous: SessionState, snapshot: SessionSnapshot): SessionState {
  let state = initialSessionState();
  // DesignResult.versions 是该请求全部版本方案（proposal 事件只带 id/version/title，卡片按 id 查这里）
  state = {
    ...state,
    status: "ready",
    request: snapshot.result.request,
    proposals: snapshot.result.versions,
    changes: snapshot.result.changes,
  };
  const snapshotMaxSeq = snapshot.events.at(-1)?.seq ?? 0;
  for (const envelope of snapshot.events) {
    state = applyEnvelope(state, envelope);
  }
  for (const envelope of previous.log) {
    if (envelope.seq > snapshotMaxSeq) state = applyEnvelope(state, envelope);
  }
  return state;
}
