import {
  addReviewEvidence,
  addReviewSource,
  createCatalogQueueItem,
  publishProduct,
} from "../src/application/catalog-review/service";
import { createHash } from "node:crypto";

/**
 * 第二批数据查证（Task 7 延续：散热器 A60 + 主板插槽批次）。
 *
 * 纪律同批次一：只有厂商官网（S1）或明确对应本型号的评测/报道（S3）才录入；
 * 推断数据（如"B850 标配 4 SATA"）、认证等级推断接口、型号身份存疑的一律进队列。
 * 所有证据不盖章（supported），待人工复核升 verified；录完即 publish 补缺落 spec。
 */

const REVIEWER = "ai:websearch-batch-2026-09-29";

type Entry = {
  productId: string;
  productName: string;
  sourceUrl: string;
  sourceTitle: string;
  tier: "S1" | "S3";
  evidence: Array<{ field: string; value: unknown; excerpt: string }>;
};

const BATCH: Entry[] = [
  {
    productId: "m-aa329a59-65d2-4bb7-9221-e931116fa6ff",
    productName: "酷里奥 A60 六热管双塔风冷",
    sourceUrl: "https://cn.coolleo.com/air-cooler/a60.html",
    sourceTitle: "酷里奥官网 A60 产品页 + 在售零售页（1700/AM5/1851）",
    tier: "S1",
    evidence: [
      { field: "heightMm", value: 154, excerpt: "官网 A60 标准版高度 154mm（注意：A60 H V2 为 156mm，H V2 是另一变体）" },
      { field: "supportedSockets", value: ["AM5", "LGA1700", "LGA1851"], excerpt: "零售页标注支持 1700/AM5/1851；AM4/LGA1200 未见本型号直接证据，暂不写入" },
    ],
  },
  {
    productId: "m-4b0f789d-9904-4e28-a7fb-1159e1632305",
    productName: "技嘉 B650M K",
    sourceUrl: "https://www.gigabyte.com/Motherboard/B650M-K-rev-11",
    sourceTitle: "技嘉官网 B650M K (Rev 1.1) 规格页",
    tier: "S1",
    evidence: [
      { field: "m2Slots", value: 2, excerpt: "SuperSpeed Storage：2 × PCIe 4.0 x4 M.2 Connectors" },
      { field: "sataPorts", value: 4, excerpt: "4 × SATA III（6Gb/s）" },
    ],
  },
  {
    productId: "m-6b0271b1-589c-4fd6-b656-37b0332d0385",
    productName: "技嘉 B840M FORCE 战鹰 WIFI6E",
    sourceUrl: "https://www.gigabyte.com/Motherboard/B840M-FORCE-WIFI6E",
    sourceTitle: "技嘉官网 B840M FORCE WIFI6E 规格页",
    tier: "S1",
    evidence: [
      { field: "ramSlots", value: 2, excerpt: "2 x DIMMs, Dual Channel DDR5" },
      { field: "m2Slots", value: 2, excerpt: "2 x M.2 Slots（CPU 直连 PCIe 4.0 x4/x2 + 芯片组 PCIe 3.0 x2）" },
      { field: "sataPorts", value: 4, excerpt: "4 x SATA 6Gb/s" },
      { field: "pcieX16Slots", value: 1, excerpt: "1 x PCIe x16（PCIe 4.0 CPU 直连）；另 1 条 PCIe 3.0 x16 物理槽实际运行 x4，不计入 x16 槽语义" },
    ],
  },
  {
    productId: "m-bd3c7dc9-e985-4fd6-a5a0-4de1338f561e",
    productName: "技嘉 B850 A ELITE WF7 小雕",
    sourceUrl: "https://post.smzdm.com/",
    sourceTitle: "什么值得买：御三家 B850 对比评测（技嘉 B850 AORUS ELITE WIFI7）",
    tier: "S3",
    evidence: [
      { field: "ramSlots", value: 4, excerpt: "4 × DDR5 DIMM，支持 XMP/EXPO（搜索聚合多来源一致）" },
      { field: "m2Slots", value: 3, excerpt: "三个 M.2，首个支持 PCIe 5.0（御三家对比评测明确描述；注意与雕妹 4×M.2、X3D 4×M.2 区分）" },
    ],
  },
  {
    productId: "m-7b9a021b-f9cb-47c3-b99f-86d3d3631f19",
    productName: "技嘉 X870 A ELITE WIFI7 ICE 冰雕",
    sourceUrl: "https://www.aorus.com/",
    sourceTitle: "AORUS 官网 X870 AORUS ELITE WIFI7 ICE 产品页 + 评测",
    tier: "S1",
    evidence: [
      { field: "ramSlots", value: 4, excerpt: "双通道 DDR5，4×DIMM 支持 AMD EXPO（官网产品页）" },
      { field: "m2Slots", value: 4, excerpt: "共 4 条 M.2，顶部 M.2 支持 PCIe 5.0（官网 + 评测一致）" },
      { field: "sataPorts", value: 4, excerpt: "4 × SATA 6Gb/s" },
      { field: "pcieX16Slots", value: 1, excerpt: "PCIe 5.0 x16 显卡插槽（带金属加固）；另一 PCIe 4.0 x16 物理槽为 x4 电气，不计入" },
    ],
  },
  {
    productId: "m-b5f3ae03-972e-42b8-8129-3b2c2141fc9b",
    productName: "技嘉 B850M FORCE WIFI6E 战鹰",
    sourceUrl: "https://news.mydrivers.com/",
    sourceTitle: "快科技 2025-08-13：技嘉战鹰 B850M FORCE WIFI6E 报道",
    tier: "S3",
    evidence: [
      { field: "m2Slots", value: 3, excerpt: "3 个 M.2 插槽：PCIe 5.0×4、PCIe 4.0×4、PCIe 4.0×2 各一" },
      { field: "sataPorts", value: 4, excerpt: "4 个 SATA III 接口" },
    ],
  },
];

const QUEUE_ITEMS: Array<{ productId: string; category: "motherboard" | "psu"; missing: string[]; note: string }> = [
  {
    productId: "m-88447720-372c-411d-bbce-0660faae59b8",
    category: "motherboard",
    missing: ["ramSlots", "m2Slots", "sataPorts", "pcieX16Slots"],
    note: "华硕 PRIME B650EM-A WIFI6：搜索仅有推断级汇总，且存在衍生版本差异（部分版本仅 1 个 M.2）；另需确认型号准确名（B650EM-A vs B650M-EM-A）。查华硕官网规格页",
  },
  {
    productId: "m-bd3c7dc9-e985-4fd6-a5a0-4de1338f561e",
    category: "motherboard",
    missing: ["sataPorts", "pcieX16Slots"],
    note: "技嘉 B850 A ELITE WF7 小雕：SATA'4 口'为'芯片组标配'推断（红线禁止）；全长 PCIe 槽 ≠ x16 槽。查技嘉官网规格页",
  },
  {
    productId: "m-b5f3ae03-972e-42b8-8129-3b2c2141fc9b",
    category: "motherboard",
    missing: ["ramSlots", "pcieX16Slots"],
    note: "技嘉 B850M FORCE WIFI6E：内存槽数与 x16 槽数未见报道明确说明。查技嘉官网规格页",
  },
  ...[
    "m-c83f8b8b-71af-4cad-94ed-f2308347ef0f|技嘉 P750GS 750W",
    "m-19021045-431b-43bf-a0ac-0ecc7e3d26f2|技嘉 风魔 P650GS 650W",
    "m-1b6f8530-b477-4336-af1d-d8d9d97c97e4|机械大师 FX850 850W",
    "m-d97e1fe2-f788-4b20-994a-4c030be70266|航嘉 MVP K850 850W",
    "m-9fecc8af-4d85-4575-80ee-bc23a9eed4b5|航嘉 WD750Evo 炫金战神 750W",
    "m-eb82d241-3d2b-40c3-b987-003830bc9b8e|鑫谷 无界PRO 750W",
    "m-29337155-0322-4137-a9f1-b1a2a66154ef|鑫谷 无界PRO 850W",
    "m-c6052eb4-8417-4ca8-8c2c-68803a3e2758|骨伽 VTE X2 750W",
  ].map((item) => {
    const [productId, productName] = item.split("|");
    return {
      productId,
      category: "psu" as const,
      missing: ["pcie8pin", "twelveVhpwr"],
      note: `${productName}：搜索仅返回"认证等级/ATX3.1 推断接口"级数据（获取设计红线明确不采用）；技嘉 P750GS/P650GS 型号身份存疑（官网在售为 GP-P650G PG5 猎鹰系列，与"风魔 P650GS"对不上）。需厂商规格书/线材表逐型号确认 8pin 与 16pin 数量`,
    };
  }),
];

function contentHashOf(url: string, excerpt: string): string {
  return createHash("sha256").update(`${url}\n${excerpt}`).digest("hex");
}

let sourcesCreated = 0;
let evidenceCreated = 0;
for (const entry of BATCH) {
  const source = addReviewSource({
    canonicalProductId: entry.productId,
    sourceType: entry.tier === "S1" ? "manufacturer" : "parameter_media",
    tier: entry.tier,
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
      confidence: entry.tier === "S1" ? "high" : "medium",
      reviewer: REVIEWER,
    });
    evidenceCreated += 1;
  }
}

for (const item of QUEUE_ITEMS) {
  createCatalogQueueItem({
    queueType: "missing_field",
    category: item.category,
    userInput: null,
    candidateCanonicalIds: [item.productId],
    missingFields: item.missing,
    priority: "normal",
    reason: item.note,
  });
}

console.log(`批次二录入：来源 ${sourcesCreated} 条、证据 ${evidenceCreated} 条、队列 ${QUEUE_ITEMS.length} 项。`);

let published = 0;
for (const entry of BATCH) {
  const report = publishProduct({
    canonicalProductId: entry.productId,
    reviewer: REVIEWER,
    note: "批次二查证发布（证据待人工复核升 verified）",
  });
  const adopted = Object.entries(report.fields)
    .filter(([, result]) => result.status === "verified" || result.status === "supported")
    .map(([field, result]) => `${field}=${String(Array.isArray(result.value) ? result.value.join("/") : result.value)}`);
  console.log(`${entry.productName} → ${report.productStatus} · ${adopted.join(", ") || "无采用值"}`);
  published += 1;
}
console.log(`已发布 ${published} 个产品（采用值补缺写回 spec）。`);
