import { addReviewEvidence, addReviewSource, publishProduct, updateCatalogQueueItem } from "../src/application/catalog-review/service";
import { createHash } from "node:crypto";

/**
 * 第六批：机械大师 FX850 官方页面核查（用户提供官网截图）。
 *
 * 结论：官方规格页只公布 功率/认证/架构/电容/ATX 支持/风扇，**不公布供电接口数量**。
 * 接口字段（pcie8pin/twelveVhpwr）无官方来源，保持 unknown（规则遇该电源输出"资料不足"），
 * 红线禁止按 ATX3.1 认证推断接口。可确认项：额定 850W（S1 一手确认，升级证据链）。
 * 同页 MX850G 白金 / CXD650 银牌不在目录收录范围，未录。
 */

const REVIEWER = "ai:user-screenshot-batch-2026-09-29";
const FX850 = "m-1b6f8530-b477-4336-af1d-d8d9d97c97e4";

const source = addReviewSource({
  canonicalProductId: FX850,
  sourceType: "manufacturer",
  tier: "S1",
  sourceUrl: "http://www.m-master.cn/pd.jsp?recommendFromPid=0&id=83&fromMid=2129",
  sourceTitle: "机械大师官网 FX850 金牌产品页（用户提供截图：850W/80PLUS金牌/ATX12V V3.1/全日系电容；无接口数量信息）",
  contentHash: createHash("sha256").update("fx850-official-page-850w-gold-atx31-no-connector-info").digest("hex"),
  reviewer: REVIEWER,
});
addReviewEvidence({
  canonicalProductId: FX850,
  fieldPath: "spec.ratedWatts",
  sourceId: source.id,
  value: 850,
  excerpt: "官网产品页：功率 850W、80PLUS金牌、电源支持 ATX12V V3.1（接口数量官方未公布）",
  identityMatch: "mpn_exact",
  confidence: "high",
  reviewer: REVIEWER,
});
publishProduct({ canonicalProductId: FX850, reviewer: REVIEWER, note: "机械大师官网核查：额定功率一手确认" });

updateCatalogQueueItem("pq-2598e2b2-3c03-4897-97dc-a83a0058645f", {
  reviewer: REVIEWER,
  resolutionNote: "官方页面已核查（用户截图）：机械大师官网不公布接口数量（仅功率/认证/架构/风扇）。pcie8pin/twelveVhpwr 无官方来源，保持 unknown——规则遇该电源输出'资料不足'是诚实行为；如需补齐请提供实物接口面照片或说明书页",
});
console.log("批次六完成：FX850 额定功率 S1 确认，接口字段结论=官方不公布，队列备注已更新");
