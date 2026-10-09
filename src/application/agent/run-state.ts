import { randomUUID } from "node:crypto";
import type { AgentPhase, AgentRuntimeEvent, AgentToolCallRecord } from "@/application/agent/runtime-types";

/**
 * Run 状态机（v2 Phase 5 §8）。
 *
 * 主链固定：received → screened → understanding → retrieved → composed →
 * validated → answered。异常（超时/守卫拒绝/工具错误）不在主链上跳相，
 * 一律以 phase="anomaly" 的事件单独记录。
 * 事件只追加：每次状态变化 append 一条，携带 attemptId / promptVersion / model /
 * deadline / retrievalIds / toolCalls / fallback / errorCode（有则带）。
 */

const MAIN_CHAIN: AgentPhase[] = [
  "received",
  "screened",
  "understanding",
  "retrieved",
  "composed",
  "validated",
  "answered",
];

export function canTransition(from: AgentPhase, to: AgentPhase): boolean {
  const fromIndex = MAIN_CHAIN.indexOf(from);
  const toIndex = MAIN_CHAIN.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return false;
  return toIndex === fromIndex + 1;
}

export type AgentRunEventInput = {
  attemptId?: string | null;
  message?: string;
  retrievalIds?: string[];
  toolCalls?: AgentToolCallRecord[];
  fallback?: { reason: string; from: string; to: string };
  errorCode?: string;
};

export class AgentRunState {
  private readonly events: AgentRuntimeEvent[] = [];
  private currentPhase: AgentPhase = "received";

  constructor(private readonly attemptId: string | null = null) {
    this.append("received", "会话已接收。");
  }

  get phase(): AgentPhase {
    return this.currentPhase;
  }

  all(): readonly AgentRuntimeEvent[] {
    return this.events;
  }

  /** 推进到主链下一阶段；非法跳相抛错（状态机不允许抄近路） */
  advance(message: string, input: Omit<AgentRunEventInput, "attemptId" | "message"> = {}): AgentRuntimeEvent {
    const nextIndex = MAIN_CHAIN.indexOf(this.currentPhase) + 1;
    const next = MAIN_CHAIN[nextIndex];
    if (!next) throw new Error(`状态机已到终点 answered，无法继续推进（当前消息：${message}）`);
    const event = this.append(next, message, input);
    this.currentPhase = next;
    return event;
  }

  /** 异常记录：不改主链相位（异常后由调用方决定回退或终止） */
  anomaly(message: string, input: Omit<AgentRunEventInput, "attemptId" | "message"> = {}): AgentRuntimeEvent {
    return this.append("anomaly", message, input);
  }

  private append(phase: AgentPhase | "anomaly", message: string, input: Omit<AgentRunEventInput, "attemptId" | "message"> = {}): AgentRuntimeEvent {
    const event: AgentRuntimeEvent = {
      id: `evt-${randomUUID()}`,
      attemptId: this.attemptId,
      phase,
      at: new Date().toISOString(),
      message,
      ...(input.retrievalIds ? { retrievalIds: input.retrievalIds } : {}),
      ...(input.toolCalls ? { toolCalls: input.toolCalls } : {}),
      ...(input.fallback ? { fallback: input.fallback } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    };
    this.events.push(event);
    return event;
  }
}
