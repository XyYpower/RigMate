import { parseBudgetRevision } from "./revision";

/**
 * 修订快速路由（launch-readiness Phase 2 / blueprint §2 任务路由、§8.1 快速路径）。
 *
 * 每轮修订先过确定性分类器，再决定是否调用模型：
 * - rules：预算/已有硬件这两类确定性解析器已覆盖的指令——直接走规则，不花模型的钱和时间；
 * - question：说明类问题（"为什么选这个显卡"）——不重新生成方案，诚实指引依据位置；
 * - llm：其余修改诉求（隐含偏好、外观、组合调整）。
 * 保守原则：宁可多走 llm（守卫在合并层兜底），绝不把修改诉求误判成问题。
 */

export type RevisionRoute = "rules" | "llm" | "question";

const EXISTING_PARTS_PATTERN = /已有|保留|手里有|现有|不用配|不要配|不配/;
const WHY_PATTERN = /为什么|为啥|凭什么|依据是什么|依据在哪|好在哪|哪里好/;

export function classifyRevision(instruction: string): RevisionRoute {
  if (parseBudgetRevision(instruction) !== null) return "rules";
  if (EXISTING_PARTS_PATTERN.test(instruction)) return "rules";
  if (WHY_PATTERN.test(instruction)) return "question";
  const trimmed = instruction.trim();
  if (/[?？]$/.test(trimmed) && !/换|要|配|上|加|改|压|控/.test(trimmed)) return "question";
  return "llm";
}
