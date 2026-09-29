import type { BuildItemCategory } from "../build/types";
import type { CatalogEntry } from "./seed";
import { REQUIRED_FIELDS_BY_CATEGORY } from "./audit";
import type { PublishStatus } from "./quality";
import type { PendingCatalogItem } from "@/contracts/catalog";

/** 硬件中心总览（M22）：三层目录来源的计数、规格完整度与导入审计的纯组装 */

export type CatalogSourceKey = "seed" | "manual" | "buildcores";

export type CatalogSourceInfo = {
  key: CatalogSourceKey;
  label: string;
  count: number;
  importedAt: string | null;
  note: string | null;
  /** BuildCores 专属署名信息；其他来源为 null */
  attribution: { upstreamCommit: string; upstreamUrl: string; license: string; licenseUrl: string } | null;
};

export type CategoryCoverage = {
  category: BuildItemCategory;
  total: number;
  withSpec: number;
  bySource: Record<CatalogSourceKey, number>;
};

export type CatalogOverview = {
  sources: CatalogSourceInfo[];
  categories: CategoryCoverage[];
  totalEntries: number;
};

export type ImportRunRecord = {
  id: string;
  upstreamCommit: string;
  license: string;
  sourcePath: string;
  importedAt: string;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
};

export type SourceInput = {
  key: CatalogSourceKey;
  label: string;
  entries: CatalogEntry[];
  importedAt: string | null;
  note: string | null;
  attribution: CatalogSourceInfo["attribution"];
};

export function buildCatalogOverview(sources: SourceInput[]): CatalogOverview {
  const categories = new Map<BuildItemCategory, CategoryCoverage>();
  let totalEntries = 0;

  for (const source of sources) {
    for (const entry of source.entries) {
      totalEntries += 1;
      let coverage = categories.get(entry.category);
      if (!coverage) {
        coverage = {
          category: entry.category,
          total: 0,
          withSpec: 0,
          bySource: { seed: 0, manual: 0, buildcores: 0 },
        };
        categories.set(entry.category, coverage);
      }
      coverage.total += 1;
      coverage.bySource[source.key] += 1;
      if (Object.keys(entry.spec).length > 0) coverage.withSpec += 1;
    }
  }

  return {
    sources: sources.map((source) => ({
      key: source.key,
      label: source.label,
      count: source.entries.length,
      importedAt: source.importedAt,
      note: source.note,
      attribution: source.attribution,
    })),
    categories: [...categories.values()],
    totalEntries,
  };
}

// ---- 目录质量总览（Task 6 只读报表，PLAYBOOK §10 数据发布前检查的读侧）----

export type CatalogQualityOverview = {
  products: { total: number; byQualityStatus: Record<PublishStatus, number> };
  /** 来源分层计数（seed/manual/buildcores/zol） */
  bySource: Record<string, number>;
  /** 每类条目数与关键字段完整率 */
  categories: Array<{ category: BuildItemCategory; total: number; filledFields: number; totalFields: number; fillRate: number }>;
  evidence: {
    total: number;
    verified: number;
    productsWithEvidence: number;
    productFieldPairs: number;
    /** 有证据的产品占比（0-100） */
    productCoverageRate: number;
  };
  conflicts: { products: number; rate: number };
  stale: { products: number; rate: number };
  queue: {
    open: number;
    byType: Record<PendingCatalogItem["queueType"], number>;
    /** 阻塞最多的字段（open 队列 missingFields 聚合，前 5） */
    topBlockingFields: Array<{ field: string; count: number }>;
  };
};

const QUEUE_TYPES: PendingCatalogItem["queueType"][] = ["new_product", "missing_field", "conflict", "stale"];

export function buildQualityOverview(input: {
  records: Array<{ category: BuildItemCategory; spec: Record<string, unknown>; source: string; qualityStatus: PublishStatus }>;
  queueItems: Array<Pick<PendingCatalogItem, "queueType" | "status" | "missingFields">>;
  evidence: { total: number; verified: number; productsWithEvidence: number; productFieldPairs: number };
}): CatalogQualityOverview {
  const byQualityStatus = { verified: 0, supported: 0, partial: 0, conflicting: 0, stale: 0, rejected: 0 } as Record<PublishStatus, number>;
  const bySource: Record<string, number> = {};
  const categoryStats = new Map<BuildItemCategory, { total: number; filledFields: number; totalFields: number }>();

  for (const record of input.records) {
    byQualityStatus[record.qualityStatus] = (byQualityStatus[record.qualityStatus] ?? 0) + 1;
    bySource[record.source] = (bySource[record.source] ?? 0) + 1;
    const required = REQUIRED_FIELDS_BY_CATEGORY[record.category] ?? [];
    let stat = categoryStats.get(record.category);
    if (!stat) {
      stat = { total: 0, filledFields: 0, totalFields: 0 };
      categoryStats.set(record.category, stat);
    }
    stat.total += 1;
    stat.totalFields += required.length;
    for (const field of required) {
      const value = record.spec[field];
      if (value !== undefined && value !== null) stat.filledFields += 1;
    }
  }

  const total = input.records.length;
  const openItems = input.queueItems.filter((item) => item.status === "open");
  const blockingFields = new Map<string, number>();
  for (const item of openItems) {
    for (const field of item.missingFields) {
      blockingFields.set(field, (blockingFields.get(field) ?? 0) + 1);
    }
  }

  return {
    products: { total, byQualityStatus },
    bySource,
    categories: [...categoryStats.entries()].map(([category, stat]) => ({
      category,
      total: stat.total,
      filledFields: stat.filledFields,
      totalFields: stat.totalFields,
      fillRate: stat.totalFields > 0 ? Math.round((stat.filledFields / stat.totalFields) * 100) : 0,
    })),
    evidence: {
      ...input.evidence,
      productCoverageRate:
        total > 0 ? Math.round((input.evidence.productsWithEvidence / total) * 100) : 0,
    },
    conflicts: {
      products: byQualityStatus.conflicting,
      rate: total > 0 ? Math.round((byQualityStatus.conflicting / total) * 1000) / 10 : 0,
    },
    stale: {
      products: byQualityStatus.stale,
      rate: total > 0 ? Math.round((byQualityStatus.stale / total) * 1000) / 10 : 0,
    },
    queue: {
      open: openItems.length,
      byType: Object.fromEntries(
        QUEUE_TYPES.map((type) => [type, openItems.filter((item) => item.queueType === type).length]),
      ) as Record<PendingCatalogItem["queueType"], number>,
      topBlockingFields: [...blockingFields.entries()]
        .map(([field, count]) => ({ field, count }))
        .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field))
        .slice(0, 5),
    },
  };
}
