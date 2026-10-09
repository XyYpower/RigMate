import type { BuildItemCategory } from "@/domain/build/types";

/**
 * Agent Runtime 最小接口（v2 Phase 0 spike 产出，Phase 5 据此实现 orchestrator）。
 *
 * 决策依据：docs/design/agent-harness-decision.md —— 自研薄运行时，
 * 借鉴 Pi（earendil-works/pi）的状态/事件/封闭工具注册表形态，不复用其代码。
 * 模型永远不能越过 application service 写正式数据：工具层只读，写路径只在 service。
 */

/** 业务阶段状态机（v2 §8）：异常不在主链里，用事件记录 */
export type AgentPhase =
  | "received"
  | "screened"
  | "understanding"
  | "retrieved"
  | "composed"
  | "validated"
  | "answered";

/** 一次模型/规则尝试（重试或回退都会产生新 attemptId） */
export type AgentAttempt = {
  attemptId: string;
  /** 该尝试使用的提示词版本（prompts/registry） */
  promptVersion: string;
  /** 模型标识；规则路径为 "rule-engine" */
  model: string;
  /** 硬截止时间（ISO）；超时必须回退，不允许无限等待 */
  deadlineAt: string;
};

/** 工具调用留痕（只读工具；模型无写权限，因此没有写工具类型） */
export type AgentToolCallRecord = {
  tool: string;
  attemptId: string;
  startedAt: string;
  finishedAt: string;
  /** 命中的候选/证据 id（可回溯） */
  resultIds: string[];
  errorCode?: string;
};

/** 阶段变化/异常事件：只追加，不修改 */
export type AgentRuntimeEvent = {
  id: string;
  attemptId: string | null;
  phase: AgentPhase | "anomaly";
  at: string;
  message: string;
  /** 记录该阶段的检索命中（候选/证据 id） */
  retrievalIds?: string[];
  toolCalls?: AgentToolCallRecord[];
  /** 回退记录：为什么、从什么回退到什么（model → rule-engine 等） */
  fallback?: { reason: string; from: string; to: string };
  errorCode?: string;
};

/** Runtime 运行选项 */
export type AgentRuntimeOptions = {
  /** 单次模型尝试的软截止（毫秒）；超时触发 fallback */
  attemptDeadlineMs: number;
  /** 事件接收器（append-only） */
  onEvent: (event: AgentRuntimeEvent) => void;
};

/** 回退处理器：模型路径失败时，给出同一 CandidateSet 上的规则式结果 */
export type FallbackHandler<T> = (reason: string, attempt: AgentAttempt) => { value: T; event: AgentRuntimeEvent };

/** 截止检查：超过 deadline 的尝试必须立即抛出，由 fallback 接管 */
export function isDeadlineExceeded(attempt: AgentAttempt, now: string = new Date().toISOString()): boolean {
  return Date.parse(now) > Date.parse(attempt.deadlineAt);
}

/** 候选池压缩形态：结构化事实的最小集合（压缩后必须完整保留，见 v2 §8） */
export type CompressedCandidateFact = {
  canonicalId: string;
  category: BuildItemCategory;
  qualityStatus: "verified" | "supported";
  missingFields: string[];
  priceCents: number | null;
};
