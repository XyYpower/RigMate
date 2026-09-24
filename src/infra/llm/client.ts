import type { ZodType } from "zod";

/**
 * 可插拔 LLM 适配器（M30，ADR §1.1"可插拔 OpenAI-compatible adapter"）：
 * - 未配置 API key = 功能关闭（返回 disabled），调用方降级到本地规则——LLM 永远不是核心依赖；
 * - 结构化输出：要求模型只回 JSON，剥掉代码围栏后用 Zod 校验，不合格按失败处理；
 * - 超时用 AbortController 强制中断；失败不重试（装机目标解析值得一次快速降级，不值得等待重试）；
 * - 永远不记录 apiKey；错误只带原因不带密钥。
 */

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export const DEFAULT_LLM_TIMEOUT_MS = 12_000;

export function resolveLlmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env.RIGMATE_LLM_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.RIGMATE_LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: env.RIGMATE_LLM_MODEL?.trim() || "gpt-4o-mini",
    timeoutMs: Number(env.RIGMATE_LLM_TIMEOUT_MS) > 0 ? Number(env.RIGMATE_LLM_TIMEOUT_MS) : DEFAULT_LLM_TIMEOUT_MS,
  };
}

export type LlmJsonResult<T> = { ok: true; data: T } | { ok: false; reason: string };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** 从模型回复中提取 JSON：容忍 ```json 围栏与前后闲聊，取首个 { 到末个 } 之间的内容 */
export function extractJsonPayload(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("回复中没有 JSON 对象");
  return JSON.parse(text.slice(start, end + 1));
}

export async function completeJson<T>(options: {
  config: LlmConfig;
  system: string;
  user: string;
  schema: ZodType<T>;
  fetchImpl?: FetchLike;
}): Promise<LlmJsonResult<T>> {
  const { config, system, user, schema } = options;
  const doFetch: FetchLike = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await doFetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) {
      return { ok: false, reason: `模型服务返回 ${response.status}` };
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = extractJsonPayload(content);
    } catch (error) {
      return { ok: false, reason: `模型回复不可解析（${(error as Error).message}）` };
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, reason: "模型回复不符合目标格式" };
    }
    return { ok: true, data: result.data };
  } catch (error) {
    const reason = controller.signal.aborted
      ? `模型请求超时（${config.timeoutMs}ms）`
      : `模型请求失败（${(error as Error).message}）`;
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
