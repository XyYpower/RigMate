import { addPriceEvidence } from "../src/infra/db/repositories/price-evidence-repository";
import { callJosApi } from "../src/infra/jd/client";
import { buildItemCategorySchema, type BuildItemCategory } from "../src/domain/build/types";

/**
 * 京东联盟价格采集（next-phase 计划 Task C 价格管道的数据入口）。
 *
 * 纪律：
 * - 默认 dry-run（校验配置与关键词，不发请求）；--live 才联网；
 * - 凭证来自环境变量 JOS_APP_KEY / JOS_APP_SECRET /（可选）JOS_ACCESS_TOKEN / JOS_GATEWAY_URL，
 *   不落盘、不打印、不写进报告；
 * - API 采集的价格一律入账为 sourceType=platform_api、reviewStatus=unreviewed：
 *   机器采集未经人工，不进方案预算区间；在证据台账人工审核为 verified 后才生效（Task C 纪律）；
 * - 与目录的 canonicalProductId 关联留给人工审核步骤（按名称自动关联违反身份纪律）。
 *
 * 用法：
 *   npx tsx scripts/fetch-jd-prices.ts --keywords "RTX 5090=gpu,9950X3D=cpu" [--limit 20] [--live]
 */

const args = process.argv.slice(2);
const live = args.includes("--live");
const limitIndex = args.indexOf("--limit");
const pageSize = limitIndex >= 0 ? Math.min(Number(args[limitIndex + 1]) || 20, 20) : 20;

type KeywordSpec = { keyword: string; category: BuildItemCategory };

function parseKeywords(): KeywordSpec[] {
  const index = args.indexOf("--keywords");
  const raw = index >= 0 ? args[index + 1] ?? "" : "";
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [keyword, category] = pair.split("=").map((part) => part.trim());
      return { keyword, category: buildItemCategorySchema.parse(category || "gpu") };
    });
}

type UnionGoodsItem = {
  skuId?: number | string;
  skuName?: string;
  priceInfo?: { price?: number; jdPrice?: number; couponPrice?: number };
  shopInfo?: { shopName?: string; owner?: string };
  materialUrl?: string;
};

async function main(): Promise<void> {
  const keywords = parseKeywords();
  if (keywords.length === 0) {
    console.error('用法：--keywords "RTX 5090=gpu,9950X3D=cpu" [--limit 20] [--live]');
    process.exit(1);
  }
  const appKey = process.env.JOS_APP_KEY?.trim();
  const appSecret = process.env.JOS_APP_SECRET?.trim();
  const accessToken = process.env.JOS_ACCESS_TOKEN?.trim();
  if (live && (!appKey || !appSecret)) {
    console.error("--live 需要 JOS_APP_KEY / JOS_APP_SECRET（可选 JOS_ACCESS_TOKEN / JOS_GATEWAY_URL）。");
    process.exit(1);
  }

  console.log(`关键词 ${keywords.length} 组${live ? "（live 联网采集）" : "（dry-run，不发请求）"}：`);
  for (const spec of keywords) console.log(`  - ${spec.keyword} → ${spec.category}（每词前 ${pageSize} 条）`);
  if (!live) {
    console.log("dry-run 完成。加 --live 并配置 JOS_APP_KEY/JOS_APP_SECRET 后执行真实采集。");
    return;
  }

  let inserted = 0;
  for (const spec of keywords) {
    const call = await callJosApi({
      config: { appKey: appKey!, appSecret: appSecret!, accessToken },
      method: "jd.union.open.goods.query",
      apiParams: {
        goodsReqDTO: { keyword: spec.keyword, pageIndex: 1, pageSize },
      },
    });
    if (!call.ok) {
      console.error(`  [${spec.keyword}] 查询失败：${call.errorCode} ${call.errorMessage ?? ""}`);
      continue;
    }
    const data = call.data as { data?: UnionGoodsItem[] } | undefined;
    const items = Array.isArray(data?.data) ? data!.data! : [];
    console.log(`  [${spec.keyword}] 命中 ${items.length} 条`);
    for (const item of items) {
      const price = item.priceInfo?.price ?? item.priceInfo?.jdPrice;
      if (typeof price !== "number" || price <= 0 || !item.skuName) continue;
      const record = addPriceEvidence({
        category: spec.category,
        productName: item.skuName.slice(0, 160),
        priceCents: Math.round(price * 100),
        priceBasis: "京东价",
        sourceType: "platform_api",
        platform: "京东",
        shop: item.shopInfo?.shopName?.slice(0, 120) || "京东",
        condition: "全新",
        region: "中国大陆",
        evidenceUrl: item.materialUrl?.slice(0, 500) || undefined,
        note: `skuId=${item.skuId}；平台 API 采集，未经人工复核`,
      });
      inserted += 1;
      void record;
    }
  }
  console.log(`\n采集完成：新增 ${inserted} 条价格证据（unreviewed）。`);
  console.log("下一步：在证据台账人工复核为 verified 后，才会进入方案预算区间。");
}

void main();
