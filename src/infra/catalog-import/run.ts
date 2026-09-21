import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildItemCategorySchema, type BuildItemCategory } from "@/domain/build/types";
import type { CatalogEntry } from "@/domain/catalog/seed";
import { recordCatalogImportRun } from "@/infra/db/repositories/catalog-import-repository";
import { mapSourceRecord } from "./map";

/**
 * BuildCores OpenDB 离线导入（ADR §8.1 六道工序）：
 * schema 校验（source-schemas + map 内按类别复检）→ 类别与字段映射 →
 * 缺字段标记（故意缺省）→ 来源与许可证记录（provenance + catalog_import_runs）→
 * 导入版本固定（upstream commit 必填）。
 * 中国大陆 SKU 适配检查留给人工种子目录承担（上游以国际 SKU 为主）。
 */

export const BUILDCORES_UPSTREAM_URL = "https://github.com/buildcores/buildcores-open-db";
export const BUILDCORES_LICENSE = "ODC-By 1.0";
export const BUILDCORES_LICENSE_URL = "https://opendatacommons.org/licenses/by/1-0/";

/** 本目录八类 ↔ 上游 open-db/ 类别目录名 */
const CATEGORY_DIR: Record<BuildItemCategory, string> = {
  cpu: "CPU",
  motherboard: "Motherboard",
  gpu: "GPU",
  ram: "RAM",
  storage: "Storage",
  psu: "PSU",
  cooler: "CPUCooler",
  case: "PCCase",
};

export type ImportSummary = {
  upstreamCommit: string;
  sourceRoot: string;
  outputPath: string;
  filesRead: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  recordedErrors: string[];
  perCategory: Record<BuildItemCategory, { imported: number; skipped: number; errors: number }>;
  importRunId: string;
};

const MAX_RECORDED_ERRORS = 20;

export function runImport(options: {
  /** BuildCores 仓库克隆根目录（内含 open-db/） */
  sourceRoot: string;
  /** 上游 commit（审计硬要求：缺了就拒绝导入，见 scripts/import-buildcores.ts） */
  upstreamCommit: string;
  /** 输出 JSON 路径，默认 data/catalog/buildcores.json */
  outputPath?: string;
}): ImportSummary {
  const sourceRoot = resolve(options.sourceRoot);
  const outputPath = options.outputPath
    ? resolve(options.outputPath)
    : join(process.cwd(), "data", "catalog", "buildcores.json");

  const entries: CatalogEntry[] = [];
  const errors: string[] = [];
  let filesRead = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const perCategory = buildItemCategorySchema.options.reduce(
    (acc, category) => {
      acc[category] = { imported: 0, skipped: 0, errors: 0 };
      return acc;
    },
    {} as Record<BuildItemCategory, { imported: number; skipped: number; errors: number }>,
  );

  for (const category of buildItemCategorySchema.options) {
    const dir = join(sourceRoot, "open-db", CATEGORY_DIR[category]);
    let fileNames: string[];
    try {
      fileNames = readdirSync(dir).filter((name) => name.endsWith(".json"));
    } catch {
      // 上游类别目录缺失 = 该类别 0 条（上游结构变化不阻塞其余类别导入）
      fileNames = [];
    }

    for (const fileName of fileNames) {
      filesRead += 1;
      let record: unknown;
      try {
        record = JSON.parse(readFileSync(join(dir, fileName), "utf8"));
      } catch (error) {
        errorCount += 1;
        perCategory[category].errors += 1;
        recordError(errors, `${category}/${fileName}: JSON 解析失败（${(error as Error).message}）`);
        continue;
      }

      // 上游规则：文件名（去 .json）必须等于记录内 opendb_id
      const opendbId =
        typeof (record as { opendb_id?: unknown }).opendb_id === "string"
          ? ((record as { opendb_id: string }).opendb_id || "").trim()
          : "";
      if (!opendbId || opendbId !== fileName.replace(/\.json$/, "")) {
        errorCount += 1;
        perCategory[category].errors += 1;
        recordError(errors, `${category}/${fileName}: opendb_id 与文件名不一致`);
        continue;
      }

      const outcome = mapSourceRecord(category, record);
      if (outcome.status === "ok") {
        entries.push(outcome.entry);
        perCategory[category].imported += 1;
      } else if (outcome.status === "skipped") {
        skippedCount += 1;
        perCategory[category].skipped += 1;
      } else {
        errorCount += 1;
        perCategory[category].errors += 1;
        recordError(errors, `${category}/${fileName}: ${outcome.reason}`);
      }
    }
  }

  if (entries.length === 0) {
    throw new Error(`导入结果为空（读取 ${filesRead} 个文件，错误 ${errorCount}），拒绝写入目录文件。`);
  }

  // 固定顺序保证产物可复现、可 diff：类别按领域顺序，类内按名称
  const categoryOrder = new Map(buildItemCategorySchema.options.map((c, i) => [c, i]));
  entries.sort(
    (a, b) =>
      categoryOrder.get(a.category)! - categoryOrder.get(b.category)! ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );

  const payload = {
    provenance: {
      upstreamCommit: options.upstreamCommit,
      upstreamUrl: BUILDCORES_UPSTREAM_URL,
      license: BUILDCORES_LICENSE,
      licenseUrl: BUILDCORES_LICENSE_URL,
      importedAt: new Date().toISOString(),
      entryCount: entries.length,
    },
    entries,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(payload), { encoding: "utf8" });

  const importRunId = recordCatalogImportRun({
    upstreamCommit: options.upstreamCommit,
    upstreamUrl: BUILDCORES_UPSTREAM_URL,
    license: BUILDCORES_LICENSE,
    sourcePath: sourceRoot,
    filesRead,
    importedCount: entries.length,
    skippedCount,
    errorCount,
    errors,
  });

  return {
    upstreamCommit: options.upstreamCommit,
    sourceRoot,
    outputPath,
    filesRead,
    importedCount: entries.length,
    skippedCount,
    errorCount,
    recordedErrors: errors,
    perCategory,
    importRunId,
  };
}

function recordError(errors: string[], message: string): void {
  if (errors.length < MAX_RECORDED_ERRORS) errors.push(message);
}
