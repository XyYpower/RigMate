import { z } from "zod";

/**
 * 会话事件流契约（agent-ui-design §4，P1）。
 *
 * 以 AgentRuntimeEvent 为唯一事实源的富事件模型：orchestrator/service 每发生一步
 * 就追加一条，经 agent_event_log 落库 + 进程内总线广播，SSE 按序吐给前端。
 * envelope.seq 是 request 内单调递增的游标：断线重连用 Last-Event-ID 续传，
 * 前端把事件流折叠成时间线（UI = 事件流的投影，借鉴 ZCode EventReducer）。
 *
 * 与 contracts/design.ts 的 AgentEvent（run 维度 8 种降维事件）并存：
 * 后者仅供现有工作台 UI，P2 会话时间线切换后整体退役。
 */

/** 业务阶段状态机（与 application/agent/runtime-types.ts 的 AgentPhase 对齐） */
export const agentPhaseSchema = z.enum([
  "received",
  "screened",
  "understanding",
  "retrieved",
  "composed",
  "validated",
  "answered",
]);

export const rigEventTypeSchema = z.enum([
  "run_started",
  "phase",
  "tool_call",
  "anomaly",
  "question",
  "proposal",
  "user_message",
  "run_completed",
  "revision_merged",
]);
export type RigEventType = z.infer<typeof rigEventTypeSchema>;

export const rigPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run_started"),
    runId: z.string(),
    model: z.string(),
    promptVersion: z.string(),
  }),
  z.object({
    type: z.literal("phase"),
    runId: z.string(),
    phase: agentPhaseSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal("tool_call"),
    runId: z.string(),
    tool: z.string(),
    state: z.enum(["running", "done", "error"]),
    detail: z.string(),
    resultIds: z.array(z.string()).default([]),
    startedAt: z.string(),
    finishedAt: z.string().nullable().default(null),
  }),
  z.object({
    type: z.literal("anomaly"),
    runId: z.string(),
    message: z.string(),
    errorCode: z.string().optional(),
    fallback: z.object({ reason: z.string(), from: z.string(), to: z.string() }).optional(),
  }),
  z.object({
    type: z.literal("question"),
    runId: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("proposal"),
    runId: z.string(),
    proposalId: z.string(),
    version: z.number().int().positive(),
    title: z.string(),
  }),
  z.object({
    type: z.literal("user_message"),
    runId: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("run_completed"),
    runId: z.string(),
    status: z.enum(["ok", "blocked", "insufficient", "empty_pool", "needs_input"]),
  }),
  z.object({
    // 修订合并审计（M1）：每轮修订保存 before/instruction/model/merged + 字段清单，
    // 用于定位"模型理解错在哪"；rejectedFields = 被来源优先级拦下的漂移字段
    type: z.literal("revision_merged"),
    runId: z.string(),
    instruction: z.string(),
    beforeIntent: z.record(z.string(), z.unknown()),
    modelIntent: z.record(z.string(), z.unknown()),
    mergedIntent: z.record(z.string(), z.unknown()),
    changedFields: z.array(z.string()),
    rejectedFields: z.array(z.string()),
  }),
]);
export type RigEvent = z.infer<typeof rigPayloadSchema>;

/** 统一 envelope：seq 是 SSE 断线续传的游标（Last-Event-ID） */
export const rigEnvelopeSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  requestId: z.string(),
  runId: z.string(),
  at: z.string(),
  payload: rigPayloadSchema,
});
export type RigEnvelope = z.infer<typeof rigEnvelopeSchema>;
