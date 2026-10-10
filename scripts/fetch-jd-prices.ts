import { addPriceEvidence, type PriceEvidenceInput } from "../src/infra/db/repositories/price-evidence-repository";
import { buildJosAuthorizeUrl, exchangeJosOAuthCode } from "../src/infra/jd/client";
import { callJosApi } from "../src/infra/jd/client";
import { buildItemCategorySchema, type BuildItemCategory } from "../src/domain/build/types";

/**
 * 京东联盟价格采集（next-phase 计划 Task C 价格管道的数据入口）。
 *
 * 只使用用户账号**已开通**的接口（2026-10-10 控制台确认）：
 * - mode=rank：jd.union.open.goods.rank.query——实时热销榜，发现热门 SKU（req: rankId/sortType/pageIndex/pageSize）；
 * - mode=promotion-sku：jd.union.open.goods.promotiongoodsinfo.query——批量 skuId 查名称/价格；
 * - mode=selling：jd.union.open.selling.goods.query——商羚批量查询（名称/价格/30天销量）；
 * - mode=keyword：jd.union.open.goods.query——关键词搜索（不在已开通列表，可能 403，保留尝试）。
 *
 * 纪律：
 * - 默认 dry-run；--live 才联网。凭证来自 JOS_APP_KEY / JOS_APP_SECRET /（可选）JOS_ACCESS_TOKEN，
 *   不落盘、不打印；
 * - 采集价格一律 sourceType=platform_api、reviewStatus=unreviewed：未经人工不进方案预算区间，
 *   证据台账人工审核 verified 后生效（Task C 纪律）；
 * - canonicalProductId 关联留给人工审核步骤（按名称自动关联违反身份纪律）。
 *
 * 用法示例：
 *   npx tsx scripts/fetch-jd-prices.ts --mode rank --rank-id 1 --category gpu --live
 *   npx tsx scripts/fetch-jd-prices.ts --mode promotion-sku --sku-ids "100012043978,100048394310" --category gpu --live
 */

const args = process.argv.slice(2);
const live = args.includes("--live");
const modeIndex = args.indexOf("--mode");
const mode = modeIndex >= 0 ? args[modeIndex + 1] : "rank";
const categoryIndex = args.indexOf("--category");
const category = buildItemCategorySchema.parse(categoryIndex >= 0 ? args[categoryIndex + 1] : "gpu");
const rankIdIndex = args.indexOf("--rank-id");
const rankId = rankIdIndex >= 0 ? args[rankIdIndex + 1] : "1";
const skuIdsArg = args.indexOf("--sku-ids") >= 0 ? args[args.indexOf("--sku-ids") + 1] : "";
const pageIndex = 1;
const pageSize = 20;

function argValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

type UnionGoodsItem = {
  skuId?: number | string;
  skuName?: string;
  goodsName?: string;
  priceInfo?: { price?: number; jdPrice?: number; lowestPrice?: number };
  price?: number;
  shopInfo?: { shopName?: string; owner?: string };
  materialUrl?: string;
};

function extractItems(payload: unknown): UnionGoodsItem[] {
  // 各接口返回形态不一：优先 result.data 数组，其次 result.list / result.data.list
  const node = payload as
    | { data?: unknown; list?: unknown }
    | { data?: { data?: unknown; list?: unknown } };
  if (!node) return [];
  const candidates = [
    (node as { data?: unknown }).data,
    (node as { list?: unknown }).list,
    (node as { data?: { data?: unknown } }).data?.data,
    (node as { data?: { list?: unknown } }).data?.list,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as UnionGoodsItem[];
  }
  return [];
}

function priceOf(item: UnionGoodsItem): number | undefined {
  const fromInfo = item.priceInfo?.price ?? item.priceInfo?.jdPrice ?? item.priceInfo?.lowestPrice;
  const value = typeof fromInfo === "number" ? fromInfo : typeof item.price === "number" ? item.price : undefined;
  return value !== undefined && value > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const appKey = process.env.JOS_APP_KEY?.trim();
  const appSecret = process.env.JOS_APP_SECRET?.trim();
  const accessToken = process.env.JOS_ACCESS_TOKEN?.trim();
  const gatewayUrl = process.env.JOS_GATEWAY_URL?.trim();
  if (live && (!appKey || !appSecret)) {
    console.error("--live 需要 JOS_APP_KEY / JOS_APP_SECRET（可选 JOS_ACCESS_TOKEN / JOS_GATEWAY_URL）。");
    process.exit(1);
  }
  const redirectUri = process.env.JOS_REDIRECT_URI?.trim() || "http://kepler.jd.com/oauth/code.do";
  const authCode = args.indexOf("--auth-code") >= 0 ? args[args.indexOf("--auth-code") + 1] : undefined;
  if (authCode) {
    // 授权换 token 的 redirect_uri 必须与控制台应用设置一致
    const exchanged = await exchangeJosOAuthCode({ appKey: appKey!, appSecret: appSecret!, code: authCode, redirectUri });
    if (!exchanged.ok) {
      console.error(`换 token 失败：${exchanged.error}`);
      process.exit(1);
    }
    console.log(`access_token: ${exchanged.accessToken}`);
    console.log(`refresh_token: ${exchanged.refreshToken ?? "-"}`);
    console.log("请把它写入 .env 的 JOS_ACCESS_TOKEN（不要提交到 git）。");
    return;
  }
  if (authCode) {
    // OAuth 换 token：浏览器授权地址栏 code → access_token（打印一次，写入 .env 由用户保管）
    const exchanged = await exchangeJosOAuthCode({ appKey: appKey!, appSecret: appSecret!, code: authCode });
    if (!exchanged.ok) {
      console.error(`换 token 失败：${exchanged.error}`);
      process.exit(1);
    }
    console.log(`access_token: ${exchanged.accessToken}`);
    console.log(`refresh_token: ${exchanged.refreshToken ?? "-"}`);
    console.log("请把它写入 .env 的 JOS_ACCESS_TOKEN（不要提交到 git）。");
    return;
  }

  console.log(`模式 ${mode} · 类别 ${category}${live ? " · live 联网" : " · dry-run（不发请求）"}`);
  if (!live) {
    console.log("dry-run 完成。加 --live 并配置 JOS_APP_KEY/JOS_APP_SECRET 后执行真实采集。");
    return;
  }

  let method = "jd.union.open.goods.rank.query";
  let apiParams: Record<string, unknown> = { req: { rankId, pageIndex, pageSize } };
  if (mode === "promotion-sku") {
    const skuIds = skuIdsArg.split(",").map((id) => id.trim()).filter(Boolean).map(Number);
    if (skuIds.length === 0) {
      console.error("promotion-sku 模式需要 --sku-ids \"100012,100034\"");
      process.exit(1);
    }
    method = "jd.union.open.goods.promotiongoodsinfo.query";
    apiParams = { skuIds };
  } else if (mode === "selling") {
    const skuIds = skuIdsArg.split(",").map((id) => id.trim()).filter(Boolean).map(Number);
    if (skuIds.length === 0) {
      console.error("selling 模式需要 --sku-ids \"100012,100034\"");
      process.exit(1);
    }
    method = "jd.union.open.selling.goods.query";
    apiParams = { skuIds };
  } else if (mode === "keyword") {
    const keyword = argValue("--keyword");
    if (!keyword) {
      console.error("keyword 模式需要 --keyword \"RTX 5090\"");
      process.exit(1);
    }
    method = "jd.union.open.goods.query";
    apiParams = { goodsReqDTO: { keyword, pageIndex, pageSize } };
  }

  const call = await callJosApi({
    config: { appKey: appKey!, appSecret: appSecret!, accessToken, gatewayUrl },
    method,
    apiParams,
  });
  if (!call.ok) {
    console.error(`查询失败：${call.errorCode} ${call.errorMessage ?? ""}`);
    if (call.errorCode === "TOOL_UNAVAILABLE" || call.errorCode?.includes("token")) {
      console.error("提示：联盟 API 需要 access_token 授权——在应用详情里完成联盟账号授权后重试，或把报错发我分析。");
    }
    process.exit(1);
  }

  const items = extractItems(call.data);
  console.log(`命中 ${items.length} 条`);
  let inserted = 0;
  for (const item of items) {
    const price = priceOf(item);
    const name = item.skuName ?? item.goodsName;
    if (typeof price !== "number" || !name) continue;
    const input: PriceEvidenceInput = {
      category,
      productName: name.slice(0, 160),
      priceCents: Math.round(price * 100),
      priceBasis: "京东价",
      sourceType: "platform_api",
      platform: "京东",
      shop: item.shopInfo?.shopName?.slice(0, 120) || "京东",
      condition: "全新",
      region: "中国大陆",
      evidenceUrl: item.materialUrl?.slice(0, 500) || undefined,
      note: `skuId=${item.skuId ?? "?"}；mode=${mode}；平台 API 采集，未经人工复核`,
    };
    addPriceEvidence(input);
    inserted += 1;
  }
  console.log(`\n采集完成：新增 ${inserted} 条价格证据（unreviewed）。`);
  console.log("下一步：在证据台账人工复核为 verified 后，才会进入方案预算区间。");
}

void main();
