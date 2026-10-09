import type { AgentAttempt } from "@/application/agent/runtime-types";

/**
 * 回退器（v2 Phase 5 §8）：模型路径失败（超时 / schema 错误 / 守卫拒绝 / 任何异常）
 * 时，落到同一 CandidateSet 上的规则式路径。绝不回退到固定 PREFERRED_IDS。
 * 回退原因与方向由调用方记入 RunState 的 anomaly / fallback 事件。
 */

export type FallbackOutcome<T> =
  | { path: "model"; value: T }
  | { path: "rule"; value: T; reason: string };

export async function withModelFallback<T>(input: {
  attempt: AgentAttempt;
  /** 模型路径（受守卫约束）；抛错或返回 null 都视为失败 */
  model: () => Promise<T | null>;
  /** 规则路径（同一 CandidateSet 上的确定性排序） */
  rule: () => T | Promise<T>;
}): Promise<FallbackOutcome<T>> {
  try {
    const value = await input.model();
    if (value !== null) return { path: "model", value };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { path: "rule", value: await input.rule(), reason: `模型路径失败：${reason}` };
  }
  return { path: "rule", value: await input.rule(), reason: "模型路径无可用输出（超时/守卫拒绝/空选择）" };
}
