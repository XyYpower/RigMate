import { describe, expect, it } from "vitest";
import { parseIntentWithLlm } from "@/application/design/intent-llm";

const config = {
  baseUrl: "https://gw.example.com/v1",
  apiKey: "sk-test",
  model: "test-model",
  timeoutMs: 1000,
};

function llmFetchWith(content: string) {
  return async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("LLM 意图解析", () => {
  it("解析中文目标：2 万预算 → 分（cents），用途与外观归类", async () => {
    const result = await parseIntentWithLlm({
      rawInput: "预算两万，想配白色海景房，主要剪视频和打游戏",
      explicitBudgetYuan: null,
      config,
      fetchImpl: llmFetchWith(
        '{"budgetYuan": 20000, "useCases": ["视频剪辑", "游戏"], "appearance": ["白色", "海景房"], "existingParts": [], "constraints": [], "region": "中国大陆"}',
      ),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.budgetCents).toBe(2_000_000);
      expect(result.data.useCases).toEqual(["视频剪辑", "游戏"]);
      expect(result.data.appearance).toEqual(["白色", "海景房"]);
    }
  });

  it("表单显式预算优先于模型提取", async () => {
    const result = await parseIntentWithLlm({
      rawInput: "随便配一台",
      explicitBudgetYuan: 8000,
      config,
      fetchImpl: llmFetchWith('{"budgetYuan": 99999, "useCases": [], "appearance": [], "existingParts": [], "constraints": [], "region": "中国大陆"}'),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.budgetCents).toBe(800_000);
  });

  it("模型编造字段类型 → 校验拒绝，交由调用方降级", async () => {
    const result = await parseIntentWithLlm({
      rawInput: "2万预算",
      explicitBudgetYuan: null,
      config,
      fetchImpl: llmFetchWith('{"budgetYuan": "两万", "useCases": ["游戏"], "appearance": [], "existingParts": [], "constraints": [], "region": "中国大陆"}'),
    });
    expect(result).toEqual({ ok: false, reason: "模型回复不符合目标格式" });
  });
});
