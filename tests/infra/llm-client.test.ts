import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  calculateRetryDelay,
  completeJson,
  extractJsonPayload,
  resolveLlmConfigFromEnv,
  resolveLlmRetryOptions,
} from "@/infra/llm/client";

const schema = z.object({ answer: z.number() });

function openAiResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200 },
  );
}

/** 不等待的退避（测试只关心次数与分类，不关心真实时延） */
const NO_WAIT_RETRY = { maxAttempts: 1, baseDelayMs: 1, backoffFactor: 1, maxDelayMs: 1, jitter: false };

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
    let calls = 0;
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      retry: NO_WAIT_RETRY,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("ECONNRESET");
      },
    });
    expect(result).toEqual({ ok: false, reason: "模型请求失败（ECONNRESET）" });
    expect(calls).toBe(1);
  });

  it("超时 → 中断并报告超时（超时不重试，交给调用方策略阶梯）", async () => {
    let calls = 0;
    const result = await completeJson({
      config: { ...config, timeoutMs: 30 },
      system: "s",
      user: "u",
      schema,
      retry: { maxAttempts: 3, baseDelayMs: 1, backoffFactor: 1, maxDelayMs: 1, jitter: false },
      fetchImpl: (_input, init) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("超时");
    expect(calls).toBe(1);
  });

  it("瞬态失败（500）按预算重试后成功，重试决策可观察", async () => {
    let calls = 0;
    const retries: Array<{ failures: number; delayMs: number }> = [];
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      retry: { maxAttempts: 3, baseDelayMs: 1, backoffFactor: 2, maxDelayMs: 5, jitter: false },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("boom", { status: 500 });
        return openAiResponse('{"answer": 9}');
      },
      onRetry: (info) => retries.push({ failures: info.failures, delayMs: info.delayMs }),
    });
    expect(result).toEqual({ ok: true, data: { answer: 9 } });
    expect(calls).toBe(2);
    // 首次重试 = base * factor^0 = base
    expect(retries).toEqual([{ failures: 1, delayMs: 1 }]);
  });

  it("空补全按可重试分类，预算内重试；仍空则如实失败", async () => {
    let calls = 0;
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      retry: { maxAttempts: 2, baseDelayMs: 1, backoffFactor: 1, maxDelayMs: 1, jitter: false },
      fetchImpl: async () => {
        calls += 1;
        return openAiResponse("");
      },
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(2);
  });

  it("4xx（非 429）不重试", async () => {
    let calls = 0;
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      retry: { maxAttempts: 3, baseDelayMs: 1, backoffFactor: 1, maxDelayMs: 1, jitter: false },
      fetchImpl: async () => {
        calls += 1;
        return new Response("bad request", { status: 400 });
      },
    });
    expect(result).toEqual({ ok: false, reason: "模型服务返回 400" });
    expect(calls).toBe(1);
  });

  it("thinking=max_tokens 进请求体：关思考与输出顶都按调用传入", async () => {
    let body = "";
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      thinking: "disabled",
      maxTokens: 1234,
      retry: NO_WAIT_RETRY,
      fetchImpl: async (_input, init) => {
        body = String(init.body);
        return openAiResponse('{"answer": 1}');
      },
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(body).thinking).toEqual({ type: "disabled" });
    expect(JSON.parse(body).max_tokens).toBe(1234);
  });

  it("默认请求体不带 thinking 与 max_tokens", async () => {
    let body = "";
    await completeJson({
      config,
      system: "s",
      user: "u",
      schema,
      retry: NO_WAIT_RETRY,
      fetchImpl: async (_input, init) => {
        body = String(init.body);
        return openAiResponse('{"answer": 2}');
      },
    });
    const parsed = JSON.parse(body);
    expect(parsed.thinking).toBeUndefined();
    expect(parsed.max_tokens).toBeUndefined();
  });
});

describe("退避曲线（对齐 ZCode runner-retry 语义）", () => {
  it("base*factor 指数增长并封顶", () => {
    const retry = { maxAttempts: 10, baseDelayMs: 1000, backoffFactor: 2, maxDelayMs: 8000, jitter: false };
    expect(calculateRetryDelay({ retry, failures: 1 })).toBe(1000);
    expect(calculateRetryDelay({ retry, failures: 2 })).toBe(2000);
    expect(calculateRetryDelay({ retry, failures: 5 })).toBe(8000);
  });

  it("provider 的 Retry-After 比本地曲线更长时优先", () => {
    const retry = { maxAttempts: 10, baseDelayMs: 1000, backoffFactor: 2, maxDelayMs: 8000, jitter: false };
    expect(calculateRetryDelay({ retry, failures: 1, retryAfterMs: 5000 })).toBe(5000);
    // 更短时仍用本地曲线
    expect(calculateRetryDelay({ retry, failures: 2, retryAfterMs: 500 })).toBe(2000);
  });

  it("重试参数可由环境覆盖", () => {
    const resolved = resolveLlmRetryOptions({
      RIGMATE_LLM_RETRY_MAX_ATTEMPTS: "5",
      RIGMATE_LLM_RETRY_BASE_DELAY_MS: "250",
    } as unknown as NodeJS.ProcessEnv);
    expect(resolved.maxAttempts).toBe(5);
    expect(resolved.baseDelayMs).toBe(250);
  });
});


describe("token 用量透传（M5）", () => {
  const config = {
    baseUrl: "https://gw.example.com/v1",
    apiKey: "sk-test",
    model: "test-model",
    timeoutMs: 1000,
  };

  it("响应带 usage → 透传到 result.usage", async () => {
    const { completeJson, resolveLlmConfigFromEnv } = await import("@/infra/llm/client");
    void resolveLlmConfigFromEnv;
    const zod = await import("zod");
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema: zod.z.object({ a: zod.z.number() }),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"a":1}' } }],
            usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
          }),
          { status: 200 },
        ),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 45, totalTokens: 165 });
  });

  it("响应缺 usage → undefined，不猜", async () => {
    const { completeJson } = await import("@/infra/llm/client");
    const zod = await import("zod");
    const result = await completeJson({
      config,
      system: "s",
      user: "u",
      schema: zod.z.object({ a: zod.z.number() }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }), { status: 200 }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.usage).toBeUndefined();
  });
});
