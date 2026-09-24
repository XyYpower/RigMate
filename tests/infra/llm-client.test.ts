import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  completeJson,
  extractJsonPayload,
  resolveLlmConfigFromEnv,
} from "@/infra/llm/client";

const schema = z.object({ answer: z.number() });

function openAiResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200 },
  );
}

describe("LLM 配置解析", () => {
  it("未配置 API key = 功能关闭", () => {
    expect(resolveLlmConfigFromEnv({} as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("配置 key 后应用默认值并去掉 baseUrl 尾斜杠", () => {
    const config = resolveLlmConfigFromEnv({
      RIGMATE_LLM_API_KEY: " sk-test ",
      RIGMATE_LLM_BASE_URL: "https://gw.example.com/v1/",
    } as unknown as NodeJS.ProcessEnv);
    expect(config).toMatchObject({
      apiKey: "sk-test",
      baseUrl: "https://gw.example.com/v1",
      model: "gpt-4o-mini",
    });
  });
});

describe("extractJsonPayload", () => {
  it("容忍代码围栏与前后闲聊", () => {
    const payload = extractJsonPayload('好的，结果如下：\n```json\n{"answer": 42}\n```\n希望有帮助');
    expect(payload).toEqual({ answer: 42 });
  });

  it("没有 JSON 时报错", () => {
    expect(() => extractJsonPayload("抱歉我不会")).toThrow();
  });
});

describe("completeJson", () => {
  const config = {
    baseUrl: "https://gw.example.com/v1",
    apiKey: "sk-test",
    model: "test-model",
    timeoutMs: 1000,
  };

  it("正常回复：剥围栏 + schema 校验通过", async () => {
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      fetchImpl: async () => openAiResponse('```json\n{"answer": 7}\n```'),
    });
    expect(result).toEqual({ ok: true, data: { answer: 7 } });
  });

  it("服务报错 → ok:false 且原因不含密钥", async () => {
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      fetchImpl: async () => new Response("denied", { status: 401 }),
    });
    expect(result).toEqual({ ok: false, reason: "模型服务返回 401" });
    expect(JSON.stringify(result)).not.toContain("sk-test");
  });

  it("回复不符合 schema → ok:false", async () => {
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      fetchImpl: async () => openAiResponse('{"answer": "不是数字"}'),
    });
    expect(result.ok).toBe(false);
  });

  it("网络失败 → ok:false", async () => {
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect(result).toEqual({ ok: false, reason: "模型请求失败（ECONNRESET）" });
  });

  it("超时 → 中断并报告超时", async () => {
    const result = await completeJson({
      config: { ...config, timeoutMs: 30 },
      system: "s",
      user: "u",
      schema,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("超时");
  });
});
