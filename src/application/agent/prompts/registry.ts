import { SELECTION_PROMPT_VERSION, SELECTION_SYSTEM_PROMPT } from "./selection-v1";

/**
 * 提示词注册表（v2 Phase 4/5）：kind → { version, system }。
 * AgentEvent.promptVersion 取自这里，保证"事件里的版本号 ↔ 提示词原文"可对应。
 */

export type AgentPromptKind = "catalog-selection";

export type AgentPromptRegistration = {
  version: string;
  system: string;
};

export const AGENT_PROMPTS: Record<AgentPromptKind, AgentPromptRegistration> = {
  "catalog-selection": {
    version: SELECTION_PROMPT_VERSION,
    system: SELECTION_SYSTEM_PROMPT,
  },
};

export function getAgentPrompt(kind: AgentPromptKind): AgentPromptRegistration {
  return AGENT_PROMPTS[kind];
}
