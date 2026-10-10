import { createHash } from "node:crypto";

/**
 * 京东 JOS 开放平台网关客户端（最小实现）。
 *
 * 协议（JOS 公开文档）：POST https://api.jd.com/routerjson，系统参数
 * method / app_key / access_token / timestamp / v / format / sign / 360buy_param_json，
 * sign = MD5(secret + 按 key 排序拼接的系统参数与业务参数 + secret) 大写。
 * 本文件只实现协议本身；API 方法名由调用方传入（如 jd.union.open.goods.query）。
 */

export type JosConfig = {
  appKey: string;
  appSecret: string;
  accessToken?: string;
  /** 网关地址；默认正式环境 */
  gatewayUrl?: string;
};

export const JOS_DEFAULT_GATEWAY = "https://api.jd.com/routerjson";

/** JOS 签名：系统参数与业务参数合并后按 key 排序，secret 前后包裹取 MD5 大写 */
export function signJosRequest(
  appSecret: string,
  systemParams: Record<string, string>,
  apiParams: Record<string, unknown>,
): string {
  const merged: Record<string, string> = { ...systemParams };
  for (const [key, value] of Object.entries(apiParams)) {
    merged[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  const sorted = Object.keys(merged)
    .sort()
    .map((key) => `${key}${merged[key]}`)
    .join("");
  return createHash("md5").update(`${appSecret}${sorted}${appSecret}`, "utf8").digest("hex").toUpperCase();
}

/** 当前时刻的 JOS timestamp 格式（yyyy-MM-dd HH:mm:ss） */
export function josTimestamp(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

export type JosCallResult = {
  ok: boolean;
  /** 网关返回的业务结果（成功时为各 API 的 result 节点） */
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
};

/** 调用一个 JOS API：method 如 "jd.union.open.goods.query" */
export async function callJosApi(input: {
  config: JosConfig;
  method: string;
  version?: string;
  /** 业务参数（将作为 360buy_param_json 发送） */
  apiParams: Record<string, unknown>;
  /** 结果节点后缀：多数 API 响应为 <method 去 open>.result（如 jd_union_open_goods_query_responce.result） */
  resultNodeSuffix?: string;
  fetchImpl?: typeof fetch;
}): Promise<JosCallResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const gatewayUrl = input.config.gatewayUrl ?? JOS_DEFAULT_GATEWAY;
  const apiParamsJson = JSON.stringify(input.apiParams);
  const systemParams: Record<string, string> = {
    method: input.method,
    app_key: input.config.appKey,
    ...(input.config.accessToken ? { access_token: input.config.accessToken } : {}),
    timestamp: josTimestamp(),
    v: input.version ?? "1.0",
    format: "json",
    "360buy_param_json": apiParamsJson,
  };
  const sign = signJosRequest(input.config.appSecret, systemParams, {});

  const form = new URLSearchParams({
    ...systemParams,
    sign,
  });

  const response = await fetchImpl(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: form.toString(),
  });
  if (!response.ok) {
    return { ok: false, errorCode: `HTTP_${response.status}`, errorMessage: `网关 HTTP ${response.status}` };
  }
  const payload = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  if (!payload) {
    return { ok: false, errorCode: "BAD_RESPONSE", errorMessage: "网关返回不是 JSON" };
  }

  // 错误响应形如 { error_response: { code, msg } }
  const errorNode = payload.error_response as { code?: string; msg?: string; zh_desc?: string } | undefined;
  if (errorNode) {
    return {
      ok: false,
      errorCode: String(errorNode.code ?? "UNKNOWN"),
      errorMessage: errorNode.msg ?? errorNode.zh_desc ?? "网关返回错误",
    };
  }

  // 成功响应形如 { <method 去掉 open 加 _responce>: { result: ... , code: "0" } }
  // JOS 约定：方法名所有点替换为下划线 + _responce（jd.union.open.goods.query → jd_union_open_goods_query_responce）
  const responseNodeKey = `${input.method.replaceAll(".", "_")}_responce`;
  const responseNode = payload[responseNodeKey] as { result?: unknown; code?: string; msg?: string } | undefined;
  if (!responseNode) {
    return { ok: false, errorCode: "BAD_RESPONSE_SHAPE", errorMessage: `响应缺少 ${responseNodeKey} 节点` };
  }
  if (responseNode.code && responseNode.code !== "0") {
    return { ok: false, errorCode: responseNode.code, errorMessage: responseNode.msg ?? "业务错误" };
  }
  return { ok: true, data: responseNode.result };
}
