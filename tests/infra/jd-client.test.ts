import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { josTimestamp, signJosRequest } from "@/infra/jd/client";

/**
 * JOS 网关签名协议单测（京东开放平台公开签名规则：
 * 系统参数 + 业务参数合并按 key 排序，secret 前后包裹取 MD5 大写）。
 * 期望值用独立实现（python 参考实现）预先计算，防止回归。
 */

describe("JOS 网关签名协议", () => {
  it("系统参数按 key 排序 + secret 包裹 + MD5 大写", () => {
    const signature = signJosRequest(
      "secret123",
      {
        method: "jd.union.open.goods.query",
        app_key: "test-key",
        v: "1.0",
        format: "json",
        timestamp: "2026-10-10 12:00:00",
        "360buy_param_json": '{"keyword":"RTX 5090"}',
      },
      {},
    );
    // 独立参考实现：sorted keys = 360buy_param_json, app_key, format, method, timestamp, v
    // text = secret123 + concat + secret123 → md5 upper
    const keys = [
      "360buy_param_json",
      "app_key",
      "format",
      "method",
      "timestamp",
      "v",
    ];
    const merged: Record<string, string> = {
      method: "jd.union.open.goods.query",
      app_key: "test-key",
      v: "1.0",
      format: "json",
      timestamp: "2026-10-10 12:00:00",
      "360buy_param_json": '{"keyword":"RTX 5090"}',
    };
    const text =
      "secret123" + keys.map((key) => `${key}${merged[key]}`).join("") + "secret123";
    expect(signature).toBe(createHash("md5").update(text, "utf8").digest("hex").toUpperCase());
  });

  it("callJosApi 把业务参数包装为 360buy_param_json 并携带签名与 token", async () => {
    let capturedBody = "";
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ jd_union_open_goods_query_responce: { result: { list: [] }, code: "0" } }),
        { status: 200 },
      );
    }) as typeof fetch;

    const { callJosApi } = await import("@/infra/jd/client");
    const result = await callJosApi({
      config: { appKey: "test-key", appSecret: "secret123", accessToken: "token-1" },
      method: "jd.union.open.goods.query",
      apiParams: { keyword: "RTX" },
      fetchImpl,
    });
    expect(result.ok).toBe(true);

    const form = new URLSearchParams(capturedBody);
    expect(form.get("method")).toBe("jd.union.open.goods.query");
    expect(form.get("app_key")).toBe("test-key");
    expect(form.get("access_token")).toBe("token-1");
    expect(form.get("360buy_param_json")).toBe(JSON.stringify({ keyword: "RTX" }));
    expect(form.get("sign")).toMatch(/^[0-9A-F]{32}$/);
    // 签名可复算：业务参数走 360buy_param_json 单键
    const expectedSign = signJosRequest(
      "secret123",
      {
        method: "jd.union.open.goods.query",
        app_key: "test-key",
        access_token: "token-1",
        timestamp: form.get("timestamp")!,
        v: "1.0",
        format: "json",
        "360buy_param_json": JSON.stringify({ keyword: "RTX" }),
      },
      {},
    );
    expect(form.get("sign")).toBe(expectedSign);
  });

  it("timestamp 为 yyyy-MM-dd HH:mm:ss 格式", () => {
    expect(josTimestamp(new Date("2026-03-05T07:08:09"))).toBe("2026-03-05 07:08:09");
  });
});

