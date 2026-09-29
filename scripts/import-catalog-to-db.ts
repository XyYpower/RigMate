import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { CATALOG } from "../src/domain/catalog/seed";
import { importBuildcoresBatch } from "../src/infra/catalog-import/db-import";
import { loadBuildcoresCatalog, loadManualCatalog } from "../src/infra/catalog-import/load";
import { recordCatalogImportRun } from "../src/infra/db/repositories/catalog-import-repository";
import {
  countCatalogEntries,
  mergeCatalogUpdates,
  upsertCatalogEntries,
} from "../src/infra/db/repositories/catalog-repository";

/**
 * 自有规格库入库 CLI（M29，ADR §8.1 canonical_products）：
 *
 * 初始化（存量三层目录 → 库，幂等，可重复执行）：
 *   npm run catalog:db
 *
 * BuildCores 审计合并（补缺 + 冲突留痕降级，产物来自 npm run import-catalog）：
 *   npm run catalog:db -- --merge-buildcores
 *
 * 补缺更新（ZOL 等外部参数源，只填缺失字段，绝不覆盖已核值）：
 *   npm run catalog:db -- --update data/catalog/zol-update.json
 *
 * 更新文件格式：
 *   { "source": "zol", "note": "抓取/核验日期", "updates": [
 *     { "id": "mb-msi-b650m-mortar", "specPatch": { "ramSlots": 4 }, "refUrl": "https://...", "aliases": ["迫击炮"] } ] }
 *
 * 纪律：更新只允许命中已有条目（id 必填）；未命中的 id 进报告交人工走目录流程，
 * 不允许外部数据源静默创建新品。
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const mergeBuildcores = process.argv.includes("--merge-buildcores");
const updateFile = argValue("--update");

if (mergeBuildcores) {
  const buildcores = loadBuildcoresCatalog();
  if (!buildcores) {
    console.error("尚未找到 BuildCores 导入产物（data/catalog/buildcores.json）。请先执行 npm run import-catalog。");
    process.exit(1);
  }
  console.log(`BuildCores 审计合并：${buildcores.entries.length} 条（commit ${buildcores.provenance.upstreamCommit.slice(0, 12)}）…`);
  const report = importBuildcoresBatch(buildcores.entries, {
    upstreamCommit: buildcores.provenance.upstreamCommit,
    upstreamUrl: buildcores.provenance.upstreamUrl,
    license: buildcores.provenance.license,
    sourcePath: "data/catalog/buildcores.json",
  });
  console.log(
    `完成：新增 ${report.inserted}，补缺 ${report.filledFields} 字段（${report.filledProducts} 产品），` +
      `冲突 ${report.conflictedFields} 字段（${report.conflictedProducts} 产品已降级 conflicting），` +
      `一致 ${report.unchangedFields}，schema 拒绝 ${report.rejectedFields}，` +
      `来源登记 ${report.sourcesCreated}，质量事件 ${report.eventsAppended}。`,
  );
  recordCatalogImportRun({
    upstreamCommit: buildcores.provenance.upstreamCommit,
    upstreamUrl: buildcores.provenance.upstreamUrl,
    license: buildcores.provenance.license,
    sourcePath: "data/catalog/buildcores.json",
    filesRead: report.total,
    importedCount: report.inserted,
    skippedCount: report.unchangedFields,
    errorCount: report.rejectedFields + report.conflictedFields,
    errors: report.conflictedFields > 0 ? [`字段冲突 ${report.conflictedFields} 处已留痕并降级，待人工复核`] : [],
  });
  console.log("冲突与补缺明细可用 npm run catalog:quality 查看；涉及冲突的产品需人工复核后才能恢复推荐。");
  process.exit(0);
}

if (updateFile) {
  const filePath = resolve(updateFile);
  if (!existsSync(filePath)) {
    console.error(`找不到更新文件：${filePath}`);
    process.exit(1);
  }
  const fileSchema = z.object({
    source: z.string().trim().min(1).default("zol"),
    note: z.string().trim().optional(),
    updates: z
      .array(
        z.object({
          id: z.string().trim().min(1),
          specPatch: z.record(z.string(), z.unknown()),
          refUrl: z.string().url().optional(),
          aliases: z.array(z.string().trim().min(1)).optional(),
        }),
      )
      .min(1),
  });
  const file = fileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));

  console.log(`补缺更新：${file.updates.length} 条（来源 ${file.source}${file.note ? ` · ${file.note}` : ""}）…`);
  const report = mergeCatalogUpdates(file.updates);
  console.log(
    `完成：更新 ${report.updated} 条，无变化 ${report.unchanged} 条，未命中 ${report.missingIds.length} 条。`,
  );
  if (report.missingIds.length > 0) {
    console.log("未命中的 id（目录里不存在，走人工目录流程录入，不自动创建）：");
    for (const id of report.missingIds) console.log(`  - ${id}`);
  }
  recordCatalogImportRun({
    upstreamCommit: `update:${file.source}`,
    upstreamUrl: null,
    license: "参考来源见更新文件 note",
    sourcePath: filePath,
    filesRead: file.updates.length,
    importedCount: report.updated,
    skippedCount: report.unchanged,
    errorCount: report.missingIds.length,
    errors: report.missingIds.map((id) => `未命中目录条目：${id}`),
  });
  if (report.updated === 0) process.exit(1);
} else {
  const manual = loadManualCatalog();
  const buildcores = loadBuildcoresCatalog();
  const before = countCatalogEntries();

  console.log("存量目录入库（种子 → 人工 → BuildCores，同 id 先到先得）…");
  const seedResult = upsertCatalogEntries(CATALOG.map((entry) => ({ ...entry, source: "seed" as const })));
  const manualResult = upsertCatalogEntries(
    (manual?.entries ?? []).map((entry) => ({ ...entry, source: "manual" as const })),
  );
  const buildcoresResult = upsertCatalogEntries(
    (buildcores?.entries ?? []).map((entry) => ({ ...entry, source: "buildcores" as const })),
  );

  const after = countCatalogEntries();
  const inserted = seedResult.inserted + manualResult.inserted + buildcoresResult.inserted;
  const skipped = seedResult.skipped + manualResult.skipped + buildcoresResult.skipped;
  console.log(
    `完成：新增 ${inserted} 条（种子 ${seedResult.inserted} / 人工 ${manualResult.inserted} / BuildCores ${buildcoresResult.inserted}），` +
      `同 id 跳过 ${skipped} 条。库内现有 ${after.toLocaleString("zh-CN")} 条（执行前 ${before.toLocaleString("zh-CN")} 条）。`,
  );

  recordCatalogImportRun({
    upstreamCommit: "catalog-db-init",
    upstreamUrl: null,
    license: buildcores ? "混合：种子/人工自有 + BuildCores ODC-By 1.0" : "自有（种子/人工）",
    sourcePath: "seed.ts + data/catalog/manual.json + data/catalog/buildcores.json",
    filesRead: 3,
    importedCount: inserted,
    skippedCount: skipped,
    errorCount: 0,
    errors: [],
  });

  if (after === 0) {
    console.error("入库后目录为空，拒绝。请先完成 BuildCores/人工目录导入（npm run import-catalog / import-manual）。");
    process.exit(1);
  }
  console.log("运行时已切换为查库优先；重启 dev server 后生效。");
}
