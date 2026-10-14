import { REQUIRED_FIELDS_BY_CATEGORY } from "@/domain/catalog/audit";
import { identityMatchOf, type IdentityMatch } from "@/domain/catalog/quality";
import type { DiscoveredProduct } from "./contract";
import { addPriceEvidence, listPriceEvidence } from "@/infra/db/repositories/price-evidence-repository";
import {
  getCatalogSnapshot,
  setCatalogNameZh,
  setCatalogQualityStatus,
  upsertCatalogEntries,
  writeCatalogMerge,
} from "@/infra/db/repositories/catalog-repository";
import {
  addFieldEvidence,
  addProductSource,
  listProductSources,
  transitionProductSourceStatus,
} from "@/infra/db/repositories/evidence-repository";

/**
 * 大陆厂商官网产品的通用落库通道（多品牌共用）。
 *
 * 与 src/infra/catalog-import/cn/asus.ts 的旧通道纪律完全一致，不因多品牌而放松：
 * - 自动来源按**必填字段完整度**决定 supported / partial，字段证据一律未人工盖章；
 * - 页面内容哈希不变就不重复记账；内容变化时把旧快照标 stale 并追加新快照；
 * - 官网标价单独写入价格证据、标注"厂商标价"，绝不混入规格质量状态。
 *
 * 与华硕专用通道的唯一差别：身份匹配用 identityMatchOf 现算，而不是写死 mpn_exact。
 * 有些厂商（如微星）不公布独立 MPN，此时身份由「厂商 + 型号」两项一致来认。
 */

export type MainlandImportReport = {
  inserted: number;
  skipped: number;
  sources: number;
  evidence: number;
  /** 官网带标价的条数（写入价格证据的数量） */
  prices: number;
};

/**
 * 身份匹配等级：与来源里已有的身份记录比一遍。
 *
 * 没有既有记录时按"厂商 + 型号齐全"给 mpn_exact（同一条官网快照自证身份）；
 * 有既有记录时必须由 identityMatchOf 判定一致，否则新快照不能覆盖旧证据。
 */
function resolveIdentityMatch(product: DiscoveredProduct, existing: ReturnType<typeof getCatalogSnapshot>): IdentityMatch {
  const incoming = {
    manufacturer: product.manufacturer,
    series: null,
    model: product.name,
    variant: null,
    mpn: product.mpn,
  };
  if (!existing) {
    // 官网 JSON-LD 的 sku 就是厂商自己给的型号码；有则 mpn_exact，无则靠字段两项一致
    return product.mpn ? "mpn_exact" : "fields_matched";
  }
  return identityMatchOf(incoming, {
    manufacturer: product.manufacturer,
    series: null,
    model: product.name,
    variant: null,
    mpn: product.mpn,
  });
}

function recordMainlandPrice(product: DiscoveredProduct, capturedAt: string): boolean {
  if (product.priceCny === undefined) return false;
  const priceCents = Math.round(product.priceCny * 100);
  const alreadyRecorded = listPriceEvidence({ canonicalProductId: product.id, limit: 500 }).some(
    (evidence) => evidence.priceCents === priceCents && evidence.evidenceUrl === product.refUrl,
  );
  if (alreadyRecorded) return false;
  addPriceEvidence({
    category: product.category,
    productName: product.name,
    priceCents,
    priceBasis: "厂商标价",
    sourceType: "manufacturer_page",
    platform: `${product.manufacturer} 中国大陆官网`,
    condition: "全新",
    canonicalProductId: product.id,
    region: "中国大陆",
    evidenceUrl: product.refUrl,
    note: "中国大陆厂商公开页面自动采集；价格未经人工核验",
    capturedAt,
  });
  return true;
}

export function importManufacturerCnProducts(products: DiscoveredProduct[]): MainlandImportReport {
  const report: MainlandImportReport = { inserted: 0, skipped: 0, sources: 0, evidence: 0, prices: 0 };

  for (const product of products) {
    const existing = getCatalogSnapshot(product.id);
    const existingSources = existing ? listProductSources(product.id) : [];
    const spec = product.spec as Record<string, unknown>;
    const missingRequiredFields = REQUIRED_FIELDS_BY_CATEGORY[product.category].filter(
      (field) => spec[field] === undefined || spec[field] === null,
    );
    const qualityStatus = missingRequiredFields.length === 0 ? "supported" : "partial";

    const sameSnapshot = existingSources.some(
      (source) =>
        source.sourceType === "manufacturer" &&
        source.contentHash === product.contentHash &&
        source.sourceVersion === product.sourceVersion,
    );

    if (sameSnapshot) {
      // 页面没变：只补可能新增的中文名与官网标价，不重复记账
      if (product.nameZh) setCatalogNameZh(product.id, product.nameZh);
      // 旧版本曾把缺必填字段的自动来源错标成 supported；重跑同步必须纠正回来
      if (existing?.qualityStatus === "supported" && qualityStatus === "partial") {
        setCatalogQualityStatus(product.id, "partial");
      }
      if (existing && JSON.stringify(existing.spec) !== JSON.stringify(spec)) {
        writeCatalogMerge(product.id, product.spec, qualityStatus, product.sourceVersion);
      }
      if (recordMainlandPrice(product, new Date().toISOString())) report.prices += 1;
      report.skipped += 1;
      continue;
    }

    const upsertResult = upsertCatalogEntries([
      {
        id: product.id,
        category: product.category,
        name: product.name,
        nameZh: product.nameZh,
        aliases: product.aliases,
        spec: product.spec,
        refUrl: product.refUrl,
        source: "manufacturer_cn",
        manufacturer: product.manufacturer,
        mpn: product.mpn,
        model: product.name,
        qualityStatus,
        sourceVersion: product.sourceVersion,
      },
    ]);
    // inserted 只统计**真正新增的行**（first-wins）：页面内容变化但条目已存在时
    // 仍要追加新来源与证据，只是不能算作新增条目。
    if (upsertResult.inserted > 0) report.inserted += 1;
    if (product.nameZh) setCatalogNameZh(product.id, product.nameZh);
    // 兼容早期把所有自动来源都标成 supported 的数据，避免缺字段继续进入候选池
    if (existing?.qualityStatus === "supported" && qualityStatus === "partial") {
      setCatalogQualityStatus(product.id, "partial");
    }
    // 同一产品的新快照（解析器升级 / 页面改版）用**完整规格替换**旧自动值。
    // 这里只对"本来就是自动来源"的产品这么做——upsert 是 first-wins，
    // 手工精选条目不会被自动采集覆盖。缺失字段按 unknown 留空，不用旧值蒙混。
    if (existing) {
      writeCatalogMerge(product.id, spec, qualityStatus, product.sourceVersion);
    }

    // 旧快照标 stale（保留历史，不删）
    for (const oldSource of existingSources) {
      if (
        oldSource.sourceType === "manufacturer" &&
        oldSource.contentHash !== product.contentHash &&
        oldSource.status !== "stale" &&
        oldSource.status !== "rejected"
      ) {
        transitionProductSourceStatus(oldSource.id, "stale", "页面内容变化，已由新大陆厂商页面快照取代");
      }
    }

    const capturedAt = new Date().toISOString();
    const source = addProductSource({
      canonicalProductId: product.id,
      sourceType: "manufacturer",
      tier: "S1",
      sourceUrl: product.refUrl,
      sourceTitle: product.sourceTitle,
      sourceVersion: product.sourceVersion,
      license: null,
      capturedAt,
      contentHash: product.contentHash,
      status: "unreviewed",
      reviewerNote: `${product.manufacturer} 中国大陆公开产品页自动采集；未人工盖章`,
    });
    report.sources += 1;

    const identityMatch = resolveIdentityMatch(product, existing);
    for (const item of product.evidence) {
      addFieldEvidence({
        canonicalProductId: product.id,
        fieldPath: item.fieldPath,
        sourceId: source.id,
        value: item.value,
        excerpt: item.excerpt,
        identityMatch,
        confidence: "high",
        verifiedAt: null,
        verifiedBy: null,
        supersedesId: null,
        createdAt: capturedAt,
      });
      report.evidence += 1;
    }

    if (recordMainlandPrice(product, capturedAt)) report.prices += 1;
  }

  return report;
}

export type { DiscoveredProduct };
