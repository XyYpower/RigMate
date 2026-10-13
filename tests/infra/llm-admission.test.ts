import { describe, expect, it } from "vitest";
import { createLlmAdmission } from "@/infra/llm/admission";

// 请求准入回归（agent-ui P4）：并发票据上限、窗口限频、释放归还、拒绝带重试等待。

describe("LLM 请求准入", () => {
  it("在飞上限内的请求拿到票据，拒绝带重试等待", () => {
    const admission = createLlmAdmission({ maxInflight: 2, maxPerWindow: 10, windowMs: 60_000 });
    const first = admission.admit("ip-1");
    const second = admission.admit("ip-1");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const third = admission.admit("ip-1");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it("release 归还槽位，后续请求可准入", () => {
    const admission = createLlmAdmission({ maxInflight: 1, maxPerWindow: 10, windowMs: 60_000 });
    const first = admission.admit("ip-1");
    expect(first.ok).toBe(true);
    const blocked = admission.admit("ip-1");
    expect(blocked.ok).toBe(false);
    if (first.ok) first.ticket.release();
    const again = admission.admit("ip-1");
    expect(again.ok).toBe(true);
    if (again.ok) again.ticket.release();
  });

  it("窗口内次数超限后拒绝，retryAfterMs 指向窗口剩余", () => {
    const admission = createLlmAdmission({ maxInflight: 10, maxPerWindow: 2, windowMs: 60_000 });
    expect(admission.admit("ip-1").ok).toBe(true);
    expect(admission.admit("ip-1").ok).toBe(true);
    const third = admission.admit("ip-1");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("不同 key 相互隔离；release 幂等且不回滚窗口配额", () => {
    const admission = createLlmAdmission({ maxInflight: 1, maxPerWindow: 2, windowMs: 60_000 });
    const a = admission.admit("ip-a");
    expect(a.ok).toBe(true);
    expect(admission.admit("ip-b").ok).toBe(true);
    if (a.ok) {
      a.ticket.release();
      a.ticket.release();
    }
    // 释放归还的是在飞槽位；已消耗的窗口次数不回滚（还剩 1 次，仍可准入）
    expect(admission.admit("ip-a").ok).toBe(true);
    expect(admission.admit("ip-a").ok).toBe(false);
  });
});
