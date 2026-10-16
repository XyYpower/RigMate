import type { ZodType } from "zod";

/**
 * 可插拔 LLM 适配器（M30，ADR §1.1"可插拔 OpenAI-compatible adapter"）：
 * - 未配置 API key = 功能关闭（返回 disabled），调用方降级到本地规则——LLM 永远不是核心依赖；
 * - 结构化输出：要求模型只回 JSON，剥掉代码围栏后用 Zod 校验，不合格按失败处理；
 * - 超时用 AbortController 强制中断；失败不重试（装机目标解析值得一次快速降级，不值得等待重试）；
 * - 永远不记录 apiKey；错误只带原因不带密钥。
 *
 * LLM 健壮性（agent-ui P4，对齐 ZCode adapters/model 的成熟语义，按零依赖规模裁剪）：
 * - 失败分类：瞬态（网络错误 / 429 / 5xx / 空补全）可重试；其余 4xx、超时（abort）、
 *   schema 拒绝不重试——超时交给调用方的策略阶梯（压缩上下文/关思考），守卫拒绝是提示词问题；
 * - 退避曲线：base * factor^(n-1)，封顶 maxDelay，jitter 0.5-1.0x，Retry-After 合理时优先；
 * - 参数全部可由环境覆盖（RIGMATE_LLM_RETRY_*），默认小而稳（2 次重试）；
 * - 思考策略：thinking 默认开启（推理模型），按调用传 "disabled" 换速度，预算用超时给足。
 */

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** 全局默认思考策略；调用级 thinking 参数优先于它 */
  thinkingDisabled?: boolean;
};

export const DEFAULT_LLM_TIMEOUT_MS = 12_000;

export type LlmThinking = "enabled" | "disabled";

export type LlmRetryOptions = {
  /** 总尝试次数（含首次） */
  maxAttempts: number;
  baseDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  jitter: boolean;
};

const DEFAULT_RETRY: LlmRetryOptions = {
  baseDelayMs: 1_500,
  backoffFactor: 2,
  jitter: true,
  maxAttempts: 3,
  maxDelayMs: 15_000,
};

/** 瞬态 HTTP 状态：网络抖动/限流/网关抖动，值得再试 */
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

export function resolveLlmRetryOptions(env: NodeJS.ProcessEnv = process.env): LlmRetryOptions {
  const maxAttempts = parsePositiveInt(env.RIGMATE_LLM_RETRY_MAX_ATTEMPTS) ?? DEFAULT_RETRY.maxAttempts;
  return {
    maxAttempts: Math.max(1, maxAttempts),
    baseDelayMs: parseNonNegativeInt(env.RIGMATE_LLM_RETRY_BASE_DELAY_MS) ?? DEFAULT_RETRY.baseDelayMs,
    backoffFactor: parsePositiveNumber(env.RIGMATE_LLM_RETRY_BACKOFF_FACTOR) ?? DEFAULT_RETRY.backoffFactor,
    maxDelayMs: parseNonNegativeInt(env.RIGMATE_LLM_RETRY_MAX_DELAY_MS) ?? DEFAULT_RETRY.maxDelayMs,
    jitter: env.RIGMATE_LLM_RETRY_JITTER === "off" ? false : DEFAULT_RETRY.jitter,
  };
}

export function resolveLlmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env.RIGMATE_LLM_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.RIGMATE_LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: env.RIGMATE_LLM_MODEL?.trim() || "gpt-4o-mini",
    timeoutMs: Number(env.RIGMATE_LLM_TIMEOUT_MS) > 0 ? Number(env.RIGMATE_LLM_TIMEOUT_MS) : DEFAULT_LLM_TIMEOUT_MS,
    /** 推理模型的结构化契约调用可整体关思考提速；调用级 thinking 参数优先 */
    thinkingDisabled: env.RIGMATE_LLM_THINKING?.trim().toLowerCase() === "disabled",
  };
}

/** token 用量（GLM/OpenAI 兼容响应自带 usage）；缺失 = 上游没给，不猜 */
export type LlmTokenUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

export type LlmJsonResult<T> = { ok: true; data: T; usage?: LlmTokenUsage } | { ok: false; reason: string };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** 从模型回复中提取 JSON：容忍 ```json 围栏与前后闲聊，取首个 { 到末个 } 之间的内容 */
export function extractJsonPayload(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("回复中没有 JSON 对象");
  return JSON.parse(text.slice(start, end + 1));
}

type RequestOutcome =
  | { kind: "ok"; data: unknown; usage?: LlmTokenUsage }
  | { kind: "failed"; reason: string; retryable: boolean; retryAfterMs?: number };

/** 响应 usage 防御解析：字段缺失或非有限数字一律 undefined，不猜 */
function parseUsage(payload: { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } }): LlmTokenUsage | undefined {
  const raw = payload.usage;
  if (!raw) return undefined;
  const toCount = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
  const promptTokens = toCount(raw.prompt_tokens);
  const completionTokens = toCount(raw.completion_tokens);
  const totalTokens = toCount(raw.total_tokens);
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  return { promptTokens, completionTokens, totalTokens: totalTokens ?? promptTokens + completionTokens };
}

/** 单次请求：超时用 AbortController 强制中断，失败分类（不在这里重试） */
async function requestOnce(options: {
  config: LlmConfig;
  thinking: LlmThinking;
  system: string;
  user: string;
  schema: ZodType<unknown>;
  maxTokens?: number;
  doFetch: FetchLike;
}): Promise<RequestOutcome> {
  const { config, thinking, system, user, schema, doFetch } = options;
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
        // 成本硬顶：按调用类型给足思考+内容预算，同时封死"被注入后长篇输出"的滥用面
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(thinking === "disabled" ? { thinking: { type: "disabled" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) {
      return {
        kind: "failed",
        reason: `模型服务返回 ${response.status}`,
        retryable: TRANSIENT_STATUS.has(response.status),
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      };
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
    };
    const usage = parseUsage(payload);
    // 空补全（推理模型把输出预算耗在思考上等）：按 ZCode empty-completion-retry 语义可重试
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (content.trim().length === 0) {
      return { kind: "failed", reason: "模型回复为空补全", retryable: true };
    }
    let parsed: unknown;
    try {
      parsed = extractJsonPayload(content);
    } catch (error) {
      return { kind: "failed", reason: `模型回复不可解析（${(error as Error).message}）`, retryable: false };
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return { kind: "failed", reason: "模型回复不符合目标格式", retryable: false };
    }
    return { kind: "ok", data: result.data, usage };
  } catch (error) {
    if (controller.signal.aborted) {
      // 超时不在客户端重试：预算已花完，交给调用方策略阶梯（压缩上下文/关思考）调整后再来
      return { kind: "failed", reason: `模型请求超时（${config.timeoutMs}ms）`, retryable: false };
    }
    return { kind: "failed", reason: `模型请求失败（${(error as Error).message}）`, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/** 退避曲线（对齐 ZCode runner-retry）：base*factor^(n-1) 封顶，jitter 0.5-1.0x，Retry-After 合理时优先 */
export function calculateRetryDelay(options: {
  retry: LlmRetryOptions;
  /** 已完成的失败次数（首次失败 = 1） */
  failures: number;
  retryAfterMs?: number;
}): number {
  const uncapped = options.retry.baseDelayMs * options.retry.backoffFactor ** Math.max(0, options.failures - 1);
  const capped = Math.min(uncapped, options.retry.maxDelayMs);
  // provider 给出比本地曲线更长的合法限流等待时，尊重它而不是退化为短退避
  if (options.retryAfterMs !== undefined && options.retryAfterMs > capped) {
    return options.retryAfterMs;
  }
  if (!options.retry.jitter || capped === 0) return capped;
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

export async function completeJson<T>(options: {
  config: LlmConfig;
  system: string;
  user: string;
  schema: ZodType<T>;
  /** 调用级思考策略；缺省用 config.thinkingDisabled 推导 */
  thinking?: LlmThinking;
  /** 单次调用输出 token 硬顶（含思考）：按调用类型给足预算，同时封死滥用输出面 */
  maxTokens?: number;
  retry?: LlmRetryOptions;
  fetchImpl?: FetchLike;
  /** 重试决策观察口（测试/日志用），不进入业务事件流 */
  onRetry?: (info: { failures: number; delayMs: number; reason: string }) => void;
}): Promise<LlmJsonResult<T>> {
  const { config, system, user, schema } = options;
  const doFetch: FetchLike = options.fetchImpl ?? fetch;
  const thinking: LlmThinking = options.thinking ?? (config.thinkingDisabled ? "disabled" : "enabled");
  const retry = options.retry ?? resolveLlmRetryOptions();
  let failures = 0;
  for (;;) {
    const outcome = await requestOnce({ config, thinking, system, user, schema, maxTokens: options.maxTokens, doFetch });
    if (outcome.kind === "ok") {
      return { ok: true, data: outcome.data as T, usage: outcome.usage };
    }
    failures += 1;
    if (!outcome.retryable || failures >= retry.maxAttempts) {
      return { ok: false, reason: outcome.reason };
    }
    const delayMs = calculateRetryDelay({ retry, failures, retryAfterMs: outcome.retryAfterMs });
    options.onRetry?.({ failures, delayMs, reason: outcome.reason });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/** Retry-After 头（秒或 HTTP 日期）；只认秒数形式，日期形式放弃（不值得为退避精度引日期解析） */
function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1000);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.floor(parsed);
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}
