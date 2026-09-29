import {
  addReviewEvidence,
  addReviewSource,
  correctProductFromEvidence,
  publishProduct,
  updateCatalogQueueItem,
} from "../src/application/catalog-review/service";
import { createHash } from "node:crypto";

/**
 * 第四批数据查证（用户协助渠道突破：官网浏览器直读 + 用户提供的官方规格图）。
 *
 * 来源升级：gigabyte.cn / colorful.cn 规格页为浏览器渲染后直读的厂商一手（S1），
 * 取代批次一的 S3 聚合证据（supersedesId 链）；FV160 为用户提供的厂商官方规格图（S1，经用户转交）。
 * 由此触发两处证据更正：GRE 287→288、GRE twelveVhpwr 1→0（官网接口表仅 8pin×2）、火神 336→337（官网 336.9 舍入）。
 */

const REVIEWER = "ai:browser-batch-2026-09-29";

type Entry = {
  productId: string;
  productName: string;
  sourceUrl: string;
  sourceTitle: string;
  /** 旧 S3 证据 id（被本批 S1 证据取代） */
  supersedes: Record<string, string>;
  evidence: Array<{ field: string; value: unknown; excerpt: string }>;
  corrections?: string;
};

const BATCH: Entry[] = [
  {
    productId: "m-500d2296-e241-4c67-ab0c-39d535c76b95",
    productName: "技嘉 RX 9070 GRE GAMING OC 魔鹰",
    sourceUrl: "https://www.gigabyte.cn/Graphics-Card/GV-R907GREGAMING-OC-12GD/sp#sp",
    sourceTitle: "技嘉中国官网 GV-R907GREGAMING-OC-12GD 产品规格页（浏览器直读）",
    supersedes: { "spec.lengthMm": "ev-90f8955b-32fc-4b5a-8eaf-ad5c38c388ee", "spec.pcie8pin": "ev-63dcdea8-e960-4e6b-9400-3684f0159693" },
    evidence: [
      { field: "lengthMm", value: 288, excerpt: "官网规格表：显卡尺寸 L=288 W=132 H=50 mm（精确值，取代聚合约值 287）" },
      { field: "pcie8pin", value: 2, excerpt: "官网规格表：供电接口 8 pin*2；建议电源 750W" },
      { field: "twelveVhpwr", value: 0, excerpt: "官网供电接口表仅列 8 pin*2，无 16pin 条目 → twelveVhpwr=0（更正此前误值 1）" },
    ],
    corrections: "官网精确值 288 取代聚合 287；twelveVhpwr 按官网接口表更正 1→0",
  },
  {
    productId: "m-71f3b52a-9605-4a70-b699-feb5abccebf3",
    productName: "七彩虹 iGame RTX 4080 SUPER Vulcan 火神",
    sourceUrl: "https://www.colorful.cn/home/product?mid=102&id=9df8a1ad-612a-4f57-8a9f-6404b32ec79d",
    sourceTitle: "七彩虹官网 iGame RTX 4080 SUPER Vulcan 16GB 规格参数页（浏览器直读）",
    supersedes: { "spec.lengthMm": "ev-26cbcfb5-a2c7-4b4a-aa6b-a1c16b5a8163", "spec.pcie8pin": "ev-603fc345-4449-4912-bd41-1dc42249fe4c" },
    evidence: [
      { field: "lengthMm", value: 337, excerpt: "官网规格表：产品尺寸 336.9*144.5*70.4mm（不带挡片）；按正整数毫米舍入 337，取代 TechPowerUp 收录值 336" },
      { field: "pcie8pin", value: 0, excerpt: "官网规格表：外接供电 16pin（无 8pin 条目）" },
      { field: "twelveVhpwr", value: 1, excerpt: "官网规格表：外接供电 16pin ×1；TDP功耗 320W；建议电源 850W 及以上" },
      { field: "tdpWatts", value: 320, excerpt: "官网规格表：TDP功耗 320W（与库内现值一致，升级为一手确认）" },
    ],
    corrections: "官网 336.9 舍入 337 取代 TechPowerUp 336",
  },
  {
    productId: "m-443cd2b2-388f-40a3-8331-035653559727",
    productName: "技嘉 RTX 5070 EAGLE OC ICE SFF 冰猎鹰",
    sourceUrl: "https://www.gigabyte.cn/Graphics-Card/GV-N5070EAGLEOC-ICE-12GD/sp#sp",
    sourceTitle: "技嘉中国官网 GV-N5070EAGLEOC ICE-12GD 产品规格页（浏览器直读）",
    supersedes: { "spec.lengthMm": "ev-dfc431cc-40ba-46c4-aca1-1795c9fa135d", "spec.pcie8pin": "ev-dfb83d21-0ed5-4f67-b9d6-4f8816b4a45c" },
    evidence: [
      { field: "lengthMm", value: 290, excerpt: "官网规格表：显卡尺寸 L=290 W=120 H=50 mm（与零售页一致，升级一手确认）" },
      { field: "pcie8pin", value: 0, excerpt: "官网规格表：供电接口 16 Pin*1（无 8pin）；建议电源 750W" },
    ],
  },
  {
    productId: "m-bd3c7dc9-e985-4fd6-a5a0-4de1338f561e",
    productName: "技嘉 B850 AORUS ELITE WIFI7 小雕",
    sourceUrl: "https://www.gigabyte.cn/Motherboard/B850-AORUS-ELITE-WIFI7/sp#sp",
    sourceTitle: "技嘉中国官网 B850 AORUS ELITE WIFI7 (rev 1.x) 产品规格页（浏览器直读）",
    supersedes: { "spec.ramSlots": "ev-f23313ba-44bd-4a2f-8b4b-1760c0f07cad", "spec.m2Slots": "ev-24532579-3fd9-4286-9c12-ba0e8c99d6f8" },
    evidence: [
      { field: "ramSlots", value: 4, excerpt: "官网规格表：4个DDR5 DIMM插槽，最高 256GB，双通道" },
      { field: "m2Slots", value: 3, excerpt: "官网规格表：M2A_CPU / M2B_CPU / M2C_SB 共 3 个 M.2 插槽（3个M.2 SSD插槽）" },
      { field: "sataPorts", value: 4, excerpt: "官网规格表：4个SATA 3.0接口" },
      { field: "pcieX16Slots", value: 1, excerpt: "官网规格表：1个PCI-E x16插槽(PCIEX16) 基于 CPU（PCIe 5.0 x16）；芯片组另有 2 个 x16 形状插槽为 x4 电气，按槽数语义不计入" },
    ],
  },
  {
    productId: "m-af792c4c-4280-4dd2-b6d8-8326a2a383a3",
    productName: "骨伽 FV160 海景房",
    sourceUrl: "https://cougargaming.com.cn/products/cases",
    sourceTitle: "骨伽 FV160 官方规格图（用户提供截图：显卡限长 380mm / CPU散热器 167MM / 兼容主板 M-ATX/ITX / 顶部360水冷）",
    supersedes: { "spec.maxGpuLengthMm": "ev-4bf570f9-b263-4816-beed-dc0406d45159" },
    evidence: [
      { field: "maxCoolerHeightMm", value: 167, excerpt: "官方规格图：CPU散热器 167MM（补队列缺口；同图确认 显卡限长 380mm、M-ATX/ITX、顶置360水冷）" },
      { field: "maxGpuLengthMm", value: 380, excerpt: "官方规格图：显卡限长 380mm（与京东规格表一致，升级为厂商一手）" },
    ],
  },
];

function contentHashOf(url: string, excerpt: string): string {
  return createHash("sha256").update(`${url}\n${excerpt}`).digest("hex");
}

let evidenceCount = 0;
for (const entry of BATCH) {
  const source = addReviewSource({
    canonicalProductId: entry.productId,
    sourceType: "manufacturer",
    tier: "S1",
    sourceUrl: entry.sourceUrl,
    sourceTitle: entry.sourceTitle,
    contentHash: contentHashOf(entry.sourceUrl, entry.evidence.map((item) => item.excerpt).join("|")),
    reviewer: REVIEWER,
  });
  for (const item of entry.evidence) {
    addReviewEvidence({
      canonicalProductId: entry.productId,
      fieldPath: `spec.${item.field}`,
      sourceId: source.id,
      value: item.value,
      excerpt: item.excerpt,
      identityMatch: "mpn_exact",
      confidence: "high",
      reviewer: REVIEWER,
      supersedesId: entry.supersedes[`spec.${item.field}`] ?? null,
    });
    evidenceCount += 1;
  }
  publishProduct({ canonicalProductId: entry.productId, reviewer: REVIEWER, note: "批次四官网一手证据发布" });
  if (entry.corrections) {
    const { corrections } = correctProductFromEvidence({
      canonicalProductId: entry.productId,
      reviewer: REVIEWER,
      reason: entry.corrections,
    });
    console.log(`${entry.productName} 更正：${corrections.map((c) => `${c.field} ${String(c.before)}→${String(c.after)}`).join(", ") || "无"}`);
  } else {
    console.log(`${entry.productName} 发布完成（无更正）`);
  }
}

// 关闭已解决的队列项
updateCatalogQueueItem("pq-c80caa81-8443-4e4d-89da-f931f6752c91", {
  status: "resolved", reviewer: REVIEWER,
  resolutionNote: "官方规格图确认 CPU 散热器限高 167mm，已录入",
});
updateCatalogQueueItem("pq-1cba87c1-45ea-4dd6-9a43-aa360dcc4598", {
  status: "resolved", reviewer: REVIEWER,
  resolutionNote: "技嘉官网规格页确认 4×SATA + 1×PCIEX16（芯片组 x16 形状槽 x4 电气不计入），已录入",
});

console.log(`批次四完成：证据 ${evidenceCount} 条（全部 S1 官网一手，supersede 旧 S3），2 个队列项关闭。`);
