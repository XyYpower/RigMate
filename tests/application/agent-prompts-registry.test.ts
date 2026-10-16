import { describe, expect, it } from "vitest";
import { AGENT_PROMPTS, getAgentPrompt } from "@/application/agent/prompts/registry";
import { ADVICE_SYSTEM_PROMPT } from "@/application/agent/prompts/advice-v1";
import { INTENT_SYSTEM_PROMPT } from "@/application/agent/prompts/intent-v1";
import { REVISION_SYSTEM_PROMPT } from "@/application/agent/prompts/revision-v1";
import { SELECTION_SYSTEM_PROMPT } from "@/application/agent/prompts/selection-v1";
import { SWAP_SYSTEM_PROMPT } from "@/application/agent/prompts/swap-v1";
import {
  INTENT_SYSTEM_PROMPT as INTENT_EXPORT,
  REVISION_SYSTEM_PROMPT as REVISION_EXPORT,
} from "@/application/design/intent-llm";

// M3 Prompt Registry 完整化：五类模型调用全部入册，版本号 ↔ 原文一一对应。
// intent-llm 的导出必须与 registry 同源——防"注册表与实际提示词两处漂移"。

describe("Prompt Registry（M3 完整化）", () => {
  it("五类调用全部注册且字段完整", () => {
    const kinds = Object.keys(AGENT_PROMPTS).sort();
    expect(kinds).toEqual(["advice", "catalog-selection", "intent", "revision", "swap"]);
    for (const [kind, registration] of Object.entries(AGENT_PROMPTS)) {
      expect(registration.version, kind).toMatch(/-v\d+$/);
      expect(registration.system.length, kind).toBeGreaterThan(50);
    }
  });

  it("registry 原文与各提示词文件一致", () => {
    expect(getAgentPrompt("catalog-selection").system).toBe(SELECTION_SYSTEM_PROMPT);
    expect(getAgentPrompt("swap").system).toBe(SWAP_SYSTEM_PROMPT);
    expect(getAgentPrompt("advice").system).toBe(ADVICE_SYSTEM_PROMPT);
    expect(getAgentPrompt("intent").system).toBe(INTENT_SYSTEM_PROMPT);
    expect(getAgentPrompt("revision").system).toBe(REVISION_SYSTEM_PROMPT);
  });

  it("intent-llm 的导出与 registry 同源（防两处漂移）", () => {
    expect(INTENT_EXPORT).toBe(INTENT_SYSTEM_PROMPT);
    expect(REVISION_EXPORT).toBe(REVISION_SYSTEM_PROMPT);
  });
});
