import { publishProduct } from "../src/application/catalog-review/service";

/** 首批查证（scripts/verify-batch-1-gpu-case.ts）的发布步骤：采用值补缺写回 spec + 质量状态落库 */
const PRODUCTS = [
  "m-443cd2b2-388f-40a3-8331-035653559727", // 技嘉 RTX 5070 EAGLE ICE SFF 冰猎鹰
  "m-71f3b52a-9605-4a70-b699-feb5abccebf3", // 七彩虹 RTX 4080 SUPER 火神 OC
  "m-500d2296-e241-4c67-ab0c-39d535c76b95", // 技嘉 RX 9070 GRE GAMING OC 魔鹰
  "m-af792c4c-4280-4dd2-b6d8-8326a2a383a3", // 骨伽 FV160
];

for (const id of PRODUCTS) {
  const report = publishProduct({ canonicalProductId: id, reviewer: "ai:websearch-batch-2026-09-29", note: "首批 GPU+机箱查证发布（证据待人工复核升 verified）" });
  const adopted = Object.entries(report.fields)
    .filter(([, result]) => result.status === "verified" || result.status === "supported")
    .map(([field, result]) => `${field}=${String(result.value)}(${result.status})`);
  console.log(`${id} → ${report.productStatus}${adopted.length > 0 ? ` · ${adopted.join(", ")}` : ""}`);
}
