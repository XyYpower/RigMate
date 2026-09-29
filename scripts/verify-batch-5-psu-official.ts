import {
  addReviewEvidence,
  addReviewSource,
  publishProduct,
  updateCatalogQueueItem,
} from "../src/application/catalog-review/service";
import { createHash } from "node:crypto";

/**
 * 第五批：厂商官网直读侦察结果落地（用户提供 4 个官网入口）。
 *
 * 战果：骨伽 VTE X2 全球官网规格表逐型号列出接口数量——VTE X2 750 =
 * PCI-E 8(6+2)pin × 4，接口枚举（Main/CPU/Peripherals/S-ATA/PCI-E）中
 * **没有 16pin 列** → twelveVhpwr = 0（S1 一手，正好补上"部分连接器数据"缺口）。
 *
 * 其余三家官网核查结论（写入队列备注，均无法录入）：
 * - 航嘉 K850：官网规格表无接口数量行，仅"ATX 3.1 + 原生 PCIe5.1 接口"规范声明
 *   （红线：规范声明推断不出接口数量）；维持 ZOL S3。另：页内型号 HK950-56PP 与
 *   标题 MVP K850 并存，型号命名待留意。
 * - 鑫谷：官网**没有"无界PRO"命名**，在售为 无界M750Pro/M850Pro/P850W Pro——
 *   样本名与在售名不能确证对应，身份问题升级。
 * - 机械大师 FX850：官网可达但规格为图片且页面不稳定，需用户提供规格图或说明书。
 */

const REVIEWER = "ai:browser-batch-2026-09-29";
const VTE_ID = "m-c6052eb4-8417-4ca8-8c2c-68803a3e2758";

const source = addReviewSource({
  canonicalProductId: VTE_ID,
  sourceType: "manufacturer",
  tier: "S1",
  sourceUrl: "https://cougargaming.com/products/psus/vte-x2/",
  sourceTitle: "COUGAR 官网 VTE X2 Specifications 接口表（浏览器直读，逐型号列明）",
  contentHash: createHash("sha256").update("vte-x2-connector-table-750:pcie8pin4,no-16pin").digest("hex"),
  reviewer: REVIEWER,
});

addReviewEvidence({
  canonicalProductId: VTE_ID,
  fieldPath: "spec.pcie8pin",
  sourceId: source.id,
  value: 4,
  excerpt: "官网接口表：VTE X2 750 行 PCI-E 8(6+2) Pins = 4（CPU 8(4+4)×1、Peripherals ×3、S-ATA ×8）",
  identityMatch: "mpn_exact",
  confidence: "high",
  reviewer: REVIEWER,
});
addReviewEvidence({
  canonicalProductId: VTE_ID,
  fieldPath: "spec.twelveVhpwr",
  sourceId: source.id,
  value: 0,
  excerpt: "官网接口表枚举 Main/CPU/Peripherals/S-ATA/PCI-E 五类，无 16pin/12VHPWR 列 → twelveVhpwr = 0（RTX 40/50 需转接线）",
  identityMatch: "mpn_exact",
  confidence: "high",
  reviewer: REVIEWER,
});

const report = publishProduct({ canonicalProductId: VTE_ID, reviewer: REVIEWER, note: "骨伽官网接口表 S1 证据发布" });
console.log(`VTE X2 750 → ${report.productStatus} · pcie8pin=${String(report.fields.pcie8pin?.value)} twelveVhpwr=${String(report.fields.twelveVhpwr?.value)}`);

// 队列：VTE X2 关闭；其余三家写官网核查备注（保持 open）
updateCatalogQueueItem("pq-1bb449ba-fc44-4102-afbe-6889ea957125", {
  status: "resolved",
  reviewer: REVIEWER,
  resolutionNote: "骨伽全球官网接口表确认：8pin×4、无 16pin，已录入（S1）",
});
updateCatalogQueueItem("pq-f3e5075a-58ae-4d2f-89c2-772bcd32285d", {
  resolutionNote: "官网核查 2026-09-29：huntkey.com 规格表无接口数量行，仅'ATX3.1 原生 PCIe5.1 接口'声明（红线不采用）；页内型号 HK950-56PP 与标题 MVP K850 并存。维持 ZOL S3 或找说明书 PDF",
  reviewer: REVIEWER,
});
updateCatalogQueueItem("pq-14150357-5daa-4a0a-adef-43948c61451b", {
  resolutionNote: "官网核查 2026-09-29：huntkey.com 同上（无接口行）；另'风魔 P650GS'型号在官网未检索到，身份存疑维持",
  reviewer: REVIEWER,
});
updateCatalogQueueItem("pq-8d627465-b284-4aab-842b-10ef656463d4", {
  resolutionNote: "官网核查 2026-09-29：segotep.com 无'无界PRO'命名，在售为 无界M750Pro/M850Pro/P850W Pro（产品页规格为图片且无'无界PRO'字样）——样本名与在售名对应关系需用户确认（购机凭证/商品页截图）",
  reviewer: REVIEWER,
});
updateCatalogQueueItem("pq-5c379d12-90d5-48d3-82fe-5510056b503d", {
  resolutionNote: "官网核查 2026-09-29：同无界PRO 750W——官网无此命名，需用户确认对应型号（无界M850Pro? P850W Pro?）",
  reviewer: REVIEWER,
});
updateCatalogQueueItem("pq-2598e2b2-3c03-4897-97dc-a83a0058645f", {
  resolutionNote: "官网核查 2026-09-29：m-master.cn 可达（http），FX850 产品页规格为图片且页面不稳定截图超时；需用户提供规格图或说明书截图",
  reviewer: REVIEWER,
});

console.log("批次五完成：VTE X2 录入发布，5 个队列项写入官网核查备注。");
