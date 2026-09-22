import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { catalogImportRuns, ensureDatabase } from "../client";

/**
 * catalog_import_runs（ADR §8.1）：一次导入 = 一行审计记录——上游 commit、
 * 许可证、来源路径、结果计数与错误样本。由导入器（scripts/import-buildcores.ts）写入。
 */

export type CatalogImportRunInput = {
  upstreamCommit: string;
  upstreamUrl: string | null;
  license: string;
  sourcePath: string;
  filesRead: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  /** 截断后的错误样本（完整错误只进控制台/导入结果） */
  errors: string[];
};

export function recordCatalogImportRun(run: CatalogImportRunInput): string {
  const id = `imp-${randomUUID()}`;
  ensureDatabase()
    .insert(catalogImportRuns)
    .values({
      id,
      upstreamCommit: run.upstreamCommit,
      upstreamUrl: run.upstreamUrl,
      license: run.license,
      sourcePath: run.sourcePath,
      importedAt: new Date().toISOString(),
      filesRead: run.filesRead,
      importedCount: run.importedCount,
      skippedCount: run.skippedCount,
      errorCount: run.errorCount,
      errors: JSON.stringify(run.errors),
    })
    .run();
  return id;
}

export type CatalogImportRunRecord = {
  id: string;
  upstreamCommit: string;
  license: string;
  sourcePath: string;
  importedAt: string;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
};

/** 硬件中心审计视图：最近的导入运行（新→旧） */
export function listCatalogImportRuns(limit = 20): CatalogImportRunRecord[] {
  return ensureDatabase()
    .select({
      id: catalogImportRuns.id,
      upstreamCommit: catalogImportRuns.upstreamCommit,
      license: catalogImportRuns.license,
      sourcePath: catalogImportRuns.sourcePath,
      importedAt: catalogImportRuns.importedAt,
      importedCount: catalogImportRuns.importedCount,
      skippedCount: catalogImportRuns.skippedCount,
      errorCount: catalogImportRuns.errorCount,
    })
    .from(catalogImportRuns)
    .orderBy(desc(catalogImportRuns.importedAt))
    .limit(limit)
    .all();
}
