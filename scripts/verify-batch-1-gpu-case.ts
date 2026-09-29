import {
  addReviewEvidence,
  addReviewSource,
  createCatalogQueueItem,
} from "../src/application/catalog-review/service";
import { createHash } from "node:crypto";

/**
 * 首批数据垂直切片查证（实施计划 Task 7 / 获取设计 §10：GPU + 机箱小样本）。
 *
 * 查证方式：Web 搜索公开规格页（2026-09-29，AI 查证）；技嘉官网被反爬（403），
 * 全部来源为引用厂商规格的零售页/参数站/电商规格表 → 一律按 S3 录入、不盖章复核，
 * 字段状态为 supported（有参考资料），等人工复核后才能升 verified。
 * 查不到官方数值的（MG520/U503/FV160 限高）不硬填，进 missing_field 队列。
 */

const REVIEWER = "ai:websearch-batch-2026-09-29";

type Entry = {
  productId: string;
  productName: string;
  sourceUrl: string;
  sourceTitle: string;
  evidence: Array<{ field: string; value: unknown; excerpt: string }>;
};

const BATCH: Entry[] = [
  {
    productId: "m-443cd2b2-388f-40a3-8331-035653559727",
    productName: "技嘉 RTX 5070 EAGLE OC ICE SFF 12G 冰猎鹰",
    sourceUrl: "https://www.3ctown.com.tw/product_show.php?product_code=0000000091825",
    sourceTitle: "3Ctown：GV-N5070EAGLEOC ICE-12GD 规格页（引用技嘉官方规格）",
    evidence: [
      { field: "lengthMm", value: 290, excerpt: "尺寸 L=290 W=120 H=50 mm（符合 NVIDIA SFF 小型化规格）" },
      { field: "pcie8pin", value: 0, excerpt: "供电接口 16-pin ×1（无 8pin），建议 750W 电源" },
    ],
  },
  {
    productId: "m-71f3b52a-9605-4a70-b699-feb5abccebf3",
    productName: "七彩虹 iGame RTX 4080 SUPER Vulcan OC 火神",
    sourceUrl: "https://www.techpowerup.com/gpu-specs/igame-geforce-rtx-4080-super-vulcan-oc.b4169/",
    sourceTitle: "TechPowerUp GPU Database：iGame RTX 4080 SUPER Vulcan OC",
    evidence: [
      { field: "lengthMm", value: 336, excerpt: "Length 13.2 inch = 336mm（官方数据；评测实测含突出部约 348.5mm）" },
      { field: "pcie8pin", value: 0, excerpt: "单 16-pin（12VHPWR/12V-2x6）供电，无 8pin；TDP 350W" },
    ],
  },
  {
    productId: "m-500d2296-e241-4c67-ab0c-39d535c76b95",
    productName: "技嘉 RX 9070 GRE GAMING OC 12G 魔鹰",
    sourceUrl: "https://www.gigabyte.com/Graphics-Card/GV-R907GREGAMING-OC-12GD",
    sourceTitle: "技嘉官网 GV-R907GREGAMING-OC-12GD 产品页（经搜索聚合，官网直接访问被反爬 403）",
    evidence: [
      { field: "lengthMm", value: 287, excerpt: "GAMING OC 版本卡长约 287mm（约值，官网页未直接打开，待人工精确复核）" },
      { field: "pcie8pin", value: 2, excerpt: "双 8-pin PCIe 供电（与 RX 9070 一致），推荐电源 650W" },
    ],
  },
  {
    productId: "m-af792c4c-4280-4dd2-b6d8-8326a2a383a3",
    productName: "骨伽 FV160 海景房",
    sourceUrl: "https://item.jd.com/",
    sourceTitle: "京东商品页规格表：骨伽 FV160 360 全景海景房机箱",
    evidence: [
      { field: "maxGpuLengthMm", value: 380, excerpt: "显卡限长 380mm（京东规格表明确标注；v2.11 待复核项，本次复核一致）" },
    ],
  },
];

const QUEUE_ITEMS: Array<{ productId: string; productName: string; missing: string[]; note: string }> = [
  {
    productId: "m-aeee301b-79cb-42e2-8875-c5de6fd6c41e",
    productName: "SAHARA 魔蛇 MG520",
    missing: ["maxGpuLengthMm", "maxCoolerHeightMm"],
    note: "公开搜索未找到官方精确数值（ZOL 参数页/旗舰店详情页需进一步查证）",
  },
  {
    productId: "m-b51c9c12-8e8d-4016-ba27-b1c7078f9d70",
    productName: "鑫谷 U503",
    missing: ["maxGpuLengthMm", "maxCoolerHeightMm"],
    note: "显卡限长来源不一致（京东页 330mm vs 部分渠道 340mm，380mm 未获证实）；散热器限高 165mm 需官网确认。查证鑫谷官网 segotep.com U503 参数规格页",
  },
  {
    productId: "m-af792c4c-4280-4dd2-b6d8-8326a2a383a3",
    productName: "骨伽 FV160",
    missing: ["maxCoolerHeightMm"],
    note: "风冷散热器限高未公布（同类海景房常见 160-170mm 仅为参考，不得据此填写）",
  },
];

function contentHashOf(url: string, excerpt: string): string {
  return createHash("sha256").update(`${url}\n${excerpt}`).digest("hex");
}

let sourcesCreated = 0;
let evidenceCreated = 0;
for (const entry of BATCH) {
  const source = addReviewSource({
    canonicalProductId: entry.productId,
    sourceType: "parameter_media",
    tier: "S3",
    sourceUrl: entry.sourceUrl,
    sourceTitle: entry.sourceTitle,
    contentHash: contentHashOf(entry.sourceUrl, entry.evidence.map((item) => item.excerpt).join("|")),
    reviewer: REVIEWER,
  });
  sourcesCreated += 1;
  for (const item of entry.evidence) {
    addReviewEvidence({
      canonicalProductId: entry.productId,
      fieldPath: `spec.${item.field}`,
      sourceId: source.id,
      value: item.value,
      excerpt: item.excerpt,
      identityMatch: "fields_matched",
      confidence: "medium",
      reviewer: REVIEWER,
    });
    evidenceCreated += 1;
  }
}

for (const item of QUEUE_ITEMS) {
  createCatalogQueueItem({
    queueType: "missing_field",
    category: "case",
    userInput: null,
    candidateCanonicalIds: [item.productId],
    missingFields: item.missing,
    priority: "normal",
    reason: `${item.productName} 缺 ${item.missing.join("/")}：${item.note}`,
  });
}

console.log(`批次完成：来源 ${sourcesCreated} 条、证据 ${evidenceCreated} 条、队列 ${QUEUE_ITEMS.length} 项（reviewer=${REVIEWER}）。`);
