import { ADVICE_PROMPT_VERSION, ADVICE_SYSTEM_PROMPT } from "./advice-v1";
import { INTENT_PROMPT_VERSION, INTENT_SYSTEM_PROMPT } from "./intent-v1";
import { REVISION_PROMPT_VERSION, REVISION_SYSTEM_PROMPT } from "./revision-v1";
import { SELECTION_PROMPT_VERSION, SELECTION_SYSTEM_PROMPT } from "./selection-v1";
import { SWAP_PROMPT_VERSION, SWAP_SYSTEM_PROMPT } from "./swap-v1";

/**
 * 提示词注册表（v2 Phase 4/5；M3 完整化：五类调用全部入册）：
 * kind → { version, system }。
 * AgentEvent.promptVersion 取自这里，保证"事件里的版本号 ↔ 提示词原文"可对应。
 */

export type AgentPromptKind = "catalog-selection" | "swap" | "advice" | "intent" | "revision";

export type AgentPromptRegistration = {
  version: string;
  system: string;
};

export const AGENT_PROMPTS: Record<AgentPromptKind, AgentPromptRegistration> = {
  "catalog-selection": {
    version: SELECTION_PROMPT_VERSION,
    system: SELECTION_SYSTEM_PROMPT,
  },
  swap: {
    version: SWAP_PROMPT_VERSION,
    system: SWAP_SYSTEM_PROMPT,
  },
  advice: {
    version: ADVICE_PROMPT_VERSION,
    system: ADVICE_SYSTEM_PROMPT,
  },
  intent: {
    version: INTENT_PROMPT_VERSION,
    system: INTENT_SYSTEM_PROMPT,
  },
  revision: {
    version: REVISION_PROMPT_VERSION,
    system: REVISION_SYSTEM_PROMPT,
  },
};

export function getAgentPrompt(kind: AgentPromptKind): AgentPromptRegistration {
  return AGENT_PROMPTS[kind];
}
