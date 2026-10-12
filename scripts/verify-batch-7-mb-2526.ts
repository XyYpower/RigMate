import { createHash } from "node:crypto";
import {
  addReviewEvidence,
  addReviewSource,
  computeProductFieldStatuses,
  listCatalogQueue,
  publishProduct,
  updateCatalogQueueItem,
} from "../src/application/catalog-review/service";
import { getCatalogSnapshot, loadCatalogEntries } from "../src/infra/db/repositories/catalog-repository";
import { listFieldEvidence, listProductSources } from "../src/infra/db/repositories/evidence-repository";
import { requiredFieldsOf } from "../src/domain/catalog/quality";

/**
 * 第七批数据查证：25-26 代际主板补池（next-phase Task E 延续，主板是八类唯一明显短板）。
 *
 * 背景：BuildCores 上游的 m2_slots 按尺寸展开不可映射，25-26 刷新入市的 Z890/X870/B850
 * 主板全部缺 m2Slots（部分还缺 sataPorts），卡在 partial 进不了候选池（池内主板仅 6 条）。
 *
 * 本批：12 块主流在售板（华硕 4 / 技嘉 2+1 / 微星 3 / 华擎 3，AM5 B850/X870 + LGA1851 Z890）
 * 的缺口字段全部来自 **S1 官方一手**（官网规格页 / 官方 datasheet PDF / 官方手册 PDF），
 * 关键数值已逐块对照原文复核；其余必填字段按 promote-minimal-pool 同款语义从导入规格快照补链
 * （BuildCores=S3 / 人工=S4）。录完即 publish 补缺落 spec；全部待人工复核升 verified。
 *
 * 纪律：
 * - 只录页面明确写出的数值，零推断（Key E 无线插座不计入 m2Slots；x16 长度 x4 电气不计入 pcieX16Slots）；
 * - 幂等（批次三教训"先查后写"）：字段已有证据行则跳过；同 URL 来源已登记则复用；
 * - 顺手关闭批次二遗留队列 pq（B850M FORCE 战鹰 ramSlots/pcieX16Slots）。
 *
 * 用法：npx tsx scripts/verify-batch-7-mb-2526.ts [--dry-run]
 */

const REVIEWER = "ai:websearch-batch-2026-10-10";
const dryRun = process.argv.includes("--dry-run");

type ResearchEntry = {
  productId: string;
  productName: string;
  sourceUrl: string;
  sourceTitle: string;
  evidence: Array<{ field: string; value: number; excerpt: string }>;
};

const RESEARCH: ResearchEntry[] = [
  {
    productId: "bc-5e60ab94-d44f-4354-aa6f-6947863cd8bd",
    productName: "ASUS TUF GAMING B850-PLUS WIFI",
    sourceUrl: "https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b850-plus-wifi/techspec/",
    sourceTitle: "ASUS 官网 TUF GAMING B850-PLUS WIFI Tech Specs 页",
    evidence: [
      { field: "m2Slots", value: 3, excerpt: "Total supports 3 x M.2 slots and 4 x SATA 6Gb/s ports；内部接口栏：3 x M.2 slots (Key M)" },
    ],
  },
  {
    productId: "bc-49bf1bb8-52e5-4511-8fd4-db816e7208d7",
    productName: "ASUS ROG STRIX B850-F GAMING WIFI",
    sourceUrl: "https://rog.asus.com/motherboards/rog-strix/rog-strix-b850-f-gaming-wifi/spec/",
    sourceTitle: "ASUS ROG 官网 ROG STRIX B850-F GAMING WIFI 规格页",
    evidence: [
      { field: "m2Slots", value: 4, excerpt: "Total supports 4 x M.2 slots and 2 x SATA 6Gb/s ports；M.2_1~M.2_4 逐条列出（Key M：两条 PCIe 5.0 x4 + 两条 PCIe 4.0 x4）" },
    ],
  },
  {
    productId: "bc-60676eaa-e2dc-44ec-9f5a-6daee77007d7",
    productName: "Asus TUF GAMING Z890-PLUS WIFI",
    sourceUrl: "https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-z890-plus-wifi/techspec/",
    sourceTitle: "ASUS 官网 TUF GAMING Z890-PLUS WIFI Tech Specs 页",
    evidence: [
      { field: "m2Slots", value: 4, excerpt: "Total Supports 4 x M.2 slots and 4 x SATA 6Gb/s ports*；内部接口栏：4 x M.2 slots (Key M)" },
    ],
  },
  {
    productId: "bc-4a69724a-817f-400a-ab14-8e60a0fea8a6",
    productName: "Asus ROG STRIX Z890-A GAMING WIFI",
    sourceUrl: "https://rog.asus.com/hk-en/motherboards/rog-strix/rog-strix-z890-a-gaming-wifi/spec/",
    sourceTitle: "ASUS ROG 官网（hk-en 区）ROG STRIX Z890-A GAMING WIFI 规格页",
    evidence: [
      { field: "m2Slots", value: 5, excerpt: "Total Supports 5 x M.2 slots and 4 x SATA 6Gb/s ports；M.2_1~M.2_5 逐条列出（Key M：M2_1 PCIe 5.0 x4，其余 PCIe 4.0 x4，M2_5 兼 SATA）" },
    ],
  },
  {
    productId: "bc-b3268aea-838b-45f9-90f1-d2bdef0e7af2",
    productName: "GIGABYTE B850M AORUS ELITE WIFI6E",
    sourceUrl: "https://www.gigabyte.cn/Motherboard/B850M-AORUS-ELITE-WIFI6E-rev-1x/sp",
    sourceTitle: "技嘉中国官网 B850M AORUS ELITE WIFI6E (rev 1.x) 产品规格页（正文经官网规格接口同源获取，非 ICE 版）",
    evidence: [
      { field: "m2Slots", value: 2, excerpt: "2个M.2 SSD插槽；储存装置接口栏逐条列出 M2A_CPU 与 M2B_CPU 共 2 个 M.2 插槽、4个SATA 3.0接口" },
    ],
  },
  {
    productId: "m-b5f3ae03-972e-42b8-8129-3b2c2141fc9b",
    productName: "技嘉 B850M FORCE WIFI6E 战鹰",
    sourceUrl: "https://www.gigabyte.cn/Motherboard/B850M-FORCE-WIFI6E-rev-12/sp",
    sourceTitle: "技嘉中国官网 B850M FORCE WIFI6E (rev 1.2) 产品规格页（官方使用手册 Rev 1001 双源一致）",
    evidence: [
      { field: "ramSlots", value: 2, excerpt: "2个DDR5 DIMM插槽，可支持高达128 GB (单一插槽支持64 GB容量)　支持双通道内存条技术" },
      { field: "pcieX16Slots", value: 1, excerpt: "1个PCI-E x16插槽(PCIEX16)，基于CPU：AMD Ryzen™ 9000/7000系列处理器，支持PCIe 5.0及x16运行规格（芯片组侧 PCIEX4 为 x4 电气，不计入）" },
    ],
  },
  {
    productId: "bc-265100d3-3431-4719-ba34-c163ae796cc2",
    productName: "MSI MAG B850 TOMAHAWK WIFI",
    sourceUrl: "https://storage-asset.msi.com/datasheet/mb/us/MAG-B850-TOMAHAWK-WIFI.pdf",
    sourceTitle: "MSI 官方 Datasheet PDF：MAG B850 TOMAHAWK WIFI（storage-asset.msi.com 官方资源域）",
    evidence: [
      { field: "m2Slots", value: 3, excerpt: "1x M.2 Gen5 x4 128Gbps slot / 2x M.2 Gen4 x4 64Gbps slots；Triple M.2 Connectors – Onboard 3x M.2 connectors with one PCIe 5.0 solution" },
    ],
  },
  {
    productId: "bc-052ea2fa-a3ef-42bc-95a9-b750ddc702f9",
    productName: "MSI B850M MAG MORTAR WIFI",
    sourceUrl: "https://storage-asset.msi.com/datasheet/mb/us/MAG-B850M-MORTAR-WIFI.pdf",
    sourceTitle: "MSI 官方 Datasheet PDF：MAG B850M MORTAR WIFI（storage-asset.msi.com 官方资源域，非 MORTAR MAX）",
    evidence: [
      { field: "m2Slots", value: 3, excerpt: "2x M.2 Gen5 x4 128Gbps slots / 1x M.2 Gen4 x2 32Gbps slot；Triple M.2 Connectors – Onboard 3x M.2 connectors with two PCIe 5.0 solution" },
    ],
  },
  {
    productId: "bc-0b273a12-6a2c-49af-92a1-be686e205ff2",
    productName: "MSI MAG X870E TOMAHAWK MAX WiFi",
    sourceUrl: "https://storage-asset.msi.com/datasheet/mb/us/MAG-X870E-TOMAHAWK-MAX-WIFI.pdf",
    sourceTitle: "MSI 官方 Datasheet PDF：MAG X870E TOMAHAWK MAX WIFI（storage-asset.msi.com 官方资源域）",
    evidence: [
      { field: "m2Slots", value: 4, excerpt: "2 x M.2 Gen5 x4 128Gbps slots / 2 x M.2 Gen4 x4 64Gbps slots；Quadruple M.2 Connectors – Onboard 4x M.2 connectors with two Lightning Gen 5 solution" },
    ],
  },
  {
    productId: "bc-87348320-5052-4e54-a692-a7dcd05496d4",
    productName: "ASRock B850 Steel Legend WiFi",
    sourceUrl: "https://download.asrock.com/Manual/B850%20Steel%20Legend%20WiFi.pdf",
    sourceTitle: "ASRock 官方用户手册 PDF：B850 Steel Legend WiFi（download.asrock.com 官方域，§1.2 Specifications）",
    evidence: [
      { field: "m2Slots", value: 4, excerpt: "1 x Blazing M.2 Socket (M2_1, Key M), supports type 2280 PCIe Gen5x4 (128 Gb/s) mode / 1 x Hyper M.2 Socket (M2_2, Key M) / 1 x Hyper M.2 Socket (M2_3, Key M) / 1 x Hyper M.2 Socket (M2_4, Key M)（另有 Vertical M.2 Socket (Key E) 无线插座，不计入）" },
    ],
  },
  {
    productId: "bc-a625de9d-a8d4-414b-ae67-2e981f4953c1",
    productName: "ASRock X870 PHANTOM GAMING NOVA WIFI",
    sourceUrl: "https://download.asrock.com/Manual/X870%20Nova%20WiFi.pdf",
    sourceTitle: "ASRock 官方用户手册 PDF：X870 Nova WiFi（download.asrock.com 官方域，芯片组行 AMD X870 非 X870E）",
    evidence: [
      { field: "m2Slots", value: 5, excerpt: "1 x Blazing M.2 Socket (M2_1, Key M), supports type 2280 PCIe Gen5x4 (128 Gb/s) mode / 1 x Blazing M.2 Socket (M2_2, Key M), supports type 2280 PCIe Gen5x4 (128 Gb/s) mode / 1 x M.2 Socket (M2_3, Key M), supports type 2280 SATA3 6.0 Gb/s & PCIe Gen3x2 (16 Gb/s) modes / 1 x Hyper M.2 Socket (M2_4, Key M) / 1 x Hyper M.2 Socket (M2_5, Key M)（另有 Key E 无线插座，不计入）" },
    ],
  },
  {
    productId: "bc-e761f025-717c-4a7a-a008-2dd8217d4941",
    productName: "ASROCK Z890 PHANTOM GAMING RIPTIDE WIFI",
    sourceUrl: "https://download.asrock.com/Manual/Z890%20Riptide%20WiFi.pdf",
    sourceTitle: "ASRock 官方用户手册 PDF：Z890 Riptide WiFi（download.asrock.com 官方域，国行名巨浪）",
    evidence: [
      { field: "m2Slots", value: 5, excerpt: "1 x Blazing M.2 Socket (M2_1, Key M), supports type 2280 PCIe Gen5x4 (128 Gb/s) mode / 1 x Hyper M.2 Socket (M2_2, Key M) / 1 x Hyper M.2 Socket (M2_3, Key M) / 1 x Hyper M.2 Socket (M2_4, Key M) / 1 x Hyper M.2 Socket (M2_5, Key M), supports type 2230/2242/2260/2280 SATA3 6.0 Gb/s & PCIe Gen4x4 modes（另有 Key E 无线插座，不计入）" },
    ],
  },
];

/** 小雕：sataPorts/pcieX16Slots 已有官网 S1 证据且用户 xyy 已盖章 verified（批次四"浏览器直读"），
 *  本批只补 socket/ramType/formFactor 三字段的导入规格链即可发布。 */
const CHAIN_ONLY_PRODUCT_IDS = new Set<string>(["m-bd3c7dc9-e985-4fd6-a5a0-4de1338f561e"]);

const CHAIN_SOURCE = {
  buildcores: {
    sourceType: "buildcores" as const,
    tier: "S3" as const,
    url: "https://github.com/buildcores/buildcores-open-db",
    title: "BuildCores OpenDB 结构化聚合",
    license: "ODC-By 1.0",
  },
  manual: {
    sourceType: "manual" as const,
    tier: "S4" as const,
    url: "https://github.com/XyYpower/RigMate",
    title: "人工/种子目录整理（M17/M20 批次）",
    license: null,
  },
};

function contentHashOf(url: string, excerpt: string): string {
  return createHash("sha256").update(url + "\n" + excerpt).digest("hex");
}

const TARGET_IDS = [...CHAIN_ONLY_PRODUCT_IDS, ...RESEARCH.map((entry) => entry.productId)];
const researchById = new Map(RESEARCH.map((entry) => [entry.productId, entry]));
const entryByName = new Map(loadCatalogEntries().map((row) => [row.id, row]));
let sourcesCreated = 0;
let evidenceCreated = 0;

for (const productId of TARGET_IDS) {
  const snapshot = getCatalogSnapshot(productId);
  if (!snapshot || snapshot.mergedInto) {
    console.log("跳过（不存在或已合并）：" + productId);
    continue;
  }
  const name = entryByName.get(productId)?.name ?? productId;
  const required = requiredFieldsOf(snapshot.category);
  const covered = new Set(listFieldEvidence(productId).map((row) => row.fieldPath));
  const entry = researchById.get(productId);

  if (entry && !dryRun) {
    let source = listProductSources(productId).find((row) => row.sourceUrl === entry.sourceUrl);
    if (!source) {
      source = addReviewSource({
        canonicalProductId: productId,
        sourceType: "manufacturer",
        tier: "S1",
        sourceUrl: entry.sourceUrl,
        sourceTitle: entry.sourceTitle,
        contentHash: contentHashOf(entry.sourceUrl, entry.evidence.map((item) => item.excerpt).join("|")),
        reviewer: REVIEWER,
      });
      sourcesCreated += 1;
    }
    for (const item of entry.evidence) {
      const fieldPath = "spec." + item.field;
      if (covered.has(fieldPath)) continue;
      addReviewEvidence({
        canonicalProductId: productId,
        fieldPath,
        sourceId: source.id,
        value: item.value,
        excerpt: item.excerpt,
        identityMatch: "fields_matched",
        confidence: "high",
        reviewer: REVIEWER,
      });
      covered.add(fieldPath);
      evidenceCreated += 1;
    }
  }

  const chain = entryByName.get(productId)?.source === "buildcores" ? CHAIN_SOURCE.buildcores : CHAIN_SOURCE.manual;
  const toChain = required.filter(
    (field) => !covered.has("spec." + field) && snapshot.spec[field] !== undefined && snapshot.spec[field] !== null,
  );
  if (toChain.length > 0 && !dryRun) {
    let chainSource = listProductSources(productId).find((row) => row.sourceUrl === chain.url);
    if (!chainSource) {
      chainSource = addReviewSource({
        canonicalProductId: productId,
        sourceType: chain.sourceType,
        tier: chain.tier,
        sourceUrl: chain.url,
        sourceTitle: chain.title,
        license: chain.license,
        contentHash: createHash("sha256").update(JSON.stringify(snapshot.spec)).digest("hex"),
        reviewer: REVIEWER,
      });
      sourcesCreated += 1;
    }
    for (const field of toChain) {
      addReviewEvidence({
        canonicalProductId: productId,
        fieldPath: "spec." + field,
        sourceId: chainSource.id,
        value: snapshot.spec[field],
        excerpt: chain.title + " 导入规格快照",
        identityMatch: "unmatched",
        confidence: "medium",
        reviewer: REVIEWER,
      });
      covered.add("spec." + field);
      evidenceCreated += 1;
    }
  }

  if (dryRun) {
    const before = computeProductFieldStatuses(productId);
    console.log("[dry-run] " + name + "：查证字段 " + (entry ? entry.evidence.map((item) => item.field).join("/") : "无") + "，补链 " + (toChain.join("/") || "无") + "，当前 " + before.productStatus);
    continue;
  }

  // 发布守卫用持久化的 quality_status 列（spec 回写只发生在 publishProduct 里；
  // computeProductFieldStatuses 是纯重算，证据补齐后即报 supported，不能作为跳过发布的依据）
  if (snapshot.qualityStatus === "supported" || snapshot.qualityStatus === "verified") {
    console.log(name + " → 已是 " + snapshot.qualityStatus + "，跳过发布");
    continue;
  }
  const report = publishProduct({
    canonicalProductId: productId,
    reviewer: REVIEWER,
    note: "批次七主板查证发布（25-26 代际补池；S1 官方一手 + 导入规格补链，待人工复核）",
  });
  const adopted = Object.entries(report.fields)
    .filter(([, result]) => result.status === "verified" || result.status === "supported")
    .map(([field, result]) => field + "=" + String(Array.isArray(result.value) ? result.value.join("/") : result.value));
  console.log(name + " → " + report.productStatus + " · " + (adopted.join(", ") || "无采用值"));
}

// 关闭批次二遗留队列：B850M FORCE 战鹰 ramSlots/pcieX16Slots 已查得官方值并入链
if (!dryRun) {
  const openItems = listCatalogQueue({ status: "open", queueType: "missing_field" });
  for (const item of openItems) {
    const ids = (item as unknown as { candidateCanonicalIds?: string[] }).candidateCanonicalIds ?? [];
    if (!ids.includes("m-b5f3ae03-972e-42b8-8129-3b2c2141fc9b")) continue;
    updateCatalogQueueItem(item.id, {
      status: "resolved",
      resolutionNote: "技嘉官网规格页查得 ramSlots=2 / pcieX16Slots=1（官方手册双源），已入链并发布（批次七）",
      reviewer: REVIEWER,
    });
    console.log("队列已关闭：" + item.id + "（B850M FORCE 战鹰）");
  }
}

console.log("批次七完成：来源 " + sourcesCreated + " 条、证据 " + evidenceCreated + " 条" + (dryRun ? "（dry-run 未写入）" : ""));
