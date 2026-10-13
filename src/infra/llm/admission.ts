/**
 * LLM 请求准入（agent-ui P4，借鉴 ZCode request-admission 的票据端口形态，按 DIY 产品规模裁剪）。
 *
 * 域封闭防线的第 3 层（前两层是严格输出契约与 max_tokens 成本顶）：LLM 只服务装机决策，
 * 不做通用问答——准入在 HTTP 入口限流限并发，刷接口的请求在碰到模型之前就被拒掉。
 *
 * - 并发票据：同 key 在飞请求数有上限（ZCode 语义：退避等待期间不持票，cap 约束在飞数）；
 * - 窗口计数：固定窗口（60s）内的 LLM 携带型请求次数有上限；
 * - 拒绝返回 retryAfterMs（窗口剩余时间），调用方转成 429。
 * - 无准入端口的调用点不必分叉：admit 永远成功（对齐 ZCode NO_ADMISSION）。
 * - globalThis 缓存与 db client 同款，规避 Next dev 热重载丢计数。
 */

export type AdmissionTicket = { release: () => void };

export type AdmissionDecision =
  | { ok: true; ticket: AdmissionTicket }
  | { ok: false; retryAfterMs: number };

export type LlmAdmission = {
  /** 拿票；拿到后必须在请求结束（含失败）时 release，finally 兜底幂等 */
  admit(key: string): AdmissionDecision;
};

type Bucket = { inflight: number; windowStartedAt: number; windowCount: number };

export function createLlmAdmission(options: {
  /** 同 key 最大在飞请求数 */
  maxInflight: number;
  /** 滑动窗口内的最大请求数 */
  maxPerWindow: number;
  windowMs: number;
}): LlmAdmission {
  const buckets = new Map<string, Bucket>();
  function bucketOf(key: string, now: number): Bucket {
    const existing = buckets.get(key);
    if (!existing || now - existing.windowStartedAt >= 60_000) {
      const fresh: Bucket = { inflight: existing?.inflight ?? 0, windowStartedAt: now, windowCount: 0 };
      buckets.set(key, fresh);
      return fresh;
    }
    return existing;
  }
  return {
    admit(key: string): AdmissionDecision {
      const now = Date.now();
      const bucket = bucketOf(key, now);
      if (bucket.inflight >= options.maxInflight) {
        return { ok: false, retryAfterMs: 3_000 };
      }
      if (bucket.windowCount >= options.maxPerWindow) {
        return { ok: false, retryAfterMs: Math.max(1_000, options.windowMs - (now - bucket.windowStartedAt)) };
      }
      bucket.inflight += 1;
      bucket.windowCount += 1;
      let released = false;
      return {
        ok: true,
        ticket: {
          release() {
            if (released) return;
            released = true;
            const current = buckets.get(key);
            if (current) current.inflight = Math.max(0, current.inflight - 1);
          },
        },
      };
    },
  };
}

type AdmissionStore = { __rigmateLlmAdmission?: LlmAdmission };
const globalStore = globalThis as unknown as AdmissionStore;

/** HTTP 入口用的默认准入：并发 2 / 每分钟 6 次（单用户自部署的合理余量） */
export function llmAdmission(): LlmAdmission {
  if (!globalStore.__rigmateLlmAdmission) {
    globalStore.__rigmateLlmAdmission = createLlmAdmission({
      maxInflight: Number(process.env.RIGMATE_LLM_MAX_INFLIGHT) > 0 ? Number(process.env.RIGMATE_LLM_MAX_INFLIGHT) : 2,
      maxPerWindow: Number(process.env.RIGMATE_LLM_MAX_PER_WINDOW) > 0 ? Number(process.env.RIGMATE_LLM_MAX_PER_WINDOW) : 6,
      windowMs: 60_000,
    });
  }
  return globalStore.__rigmateLlmAdmission;
}
