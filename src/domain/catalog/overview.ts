import type { BuildItemCategory } from "../build/types";
import type { CatalogEntry } from "./seed";

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
