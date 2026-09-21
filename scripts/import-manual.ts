import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { recordCatalogImportRun } from "../src/infra/db/repositories/catalog-import-repository";
import {
  MANUAL_CSV_HEADERS,
  manualCatalogFileSchema,
  mergeManualEntries,
  parseCsv,
  rowToEntry,
} from "../src/infra/catalog-import/manual-csv";
import type { CatalogEntry } from "../src/domain/catalog/seed";

/**
 * 人工目录批量导入（M20 方案 A）：
 *   npm run import-manual -- [--file data/catalog/人工目录模板.csv]
 *
 * 纪律：逐行校验，任何一行有问题 → 整包拒绝并逐行报错（数据由用户可修，不放坏行进来）；
 * 同类别同名 → 原地更新（保留 id），否则新增；产物 data/catalog/manual.json（本地数据层）。
 * 审计写 catalog_import_runs（upstream_commit = "manual"）。
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const fileArg = argValue("--file") ?? join(process.cwd(), "data", "catalog", "人工目录模板.csv");
if (!existsSync(fileArg)) {
  console.error(`找不到 CSV 文件：${fileArg}`);
  console.error("先运行 npm run catalog-template 生成模板，在 Excel 里核对后另存为 CSV UTF-8。");
  process.exit(1);
}

// 1. 解析
const text = readFileSync(fileArg, "utf8");
const rows = parseCsv(text);
const header = rows[0]?.map((cell) => cell.trim()) ?? [];
for (const required of MANUAL_CSV_HEADERS.slice(0, 2)) {
  if (!header.includes(required)) {
    console.error(`表头缺少必需列「${required}」。请用 npm run catalog-template 生成的模板填写。`);
    process.exit(1);
  }
}
const dataRows = rows.slice(1);

// 2. 逐行映射 + 校验
const entries: CatalogEntry[] = [];
const allErrors: string[] = [];
dataRows.forEach((row, index) => {
  if (row.every((cell) => !(cell ?? "").trim())) return; // 空行跳过
  const outcome = rowToEntry([...row, ...Array(MANUAL_CSV_HEADERS.length).fill("")].slice(0, MANUAL_CSV_HEADERS.length));
  if (outcome.status === "ok") {
    entries.push(outcome.entry);
  } else {
    const label = row[0]?.trim() || `（型号为空）`;
    allErrors.push(`第 ${index + 2} 行 ${label}：${outcome.errors.join("；")}`);
  }
});

if (allErrors.length > 0) {
  console.error(`校验失败，共 ${allErrors.length} 行有问题（整包拒绝，未写入任何数据）：`);
  for (const message of allErrors) console.error(`  - ${message}`);
  console.error("修正 CSV 后重新运行即可。");
  process.exit(1);
}

if (entries.length === 0) {
  console.error("CSV 里没有有效数据行，拒绝导入。");
  process.exit(1);
}

// 3. 与既有人工目录合并（同类别同名 → 更新保留 id）
const manualPath = process.env.RIGMATE_MANUAL_CATALOG_PATH
  ? resolve(process.env.RIGMATE_MANUAL_CATALOG_PATH)
  : join(process.cwd(), "data", "catalog", "manual.json");
let existing: CatalogEntry[] = [];
if (existsSync(manualPath)) {
  const parsed = manualCatalogFileSchema.parse(JSON.parse(readFileSync(manualPath, "utf8")));
  existing = parsed.entries as CatalogEntry[];
}
const { entries: merged, added, updated } = mergeManualEntries(existing, entries);

const payload = {
  provenance: {
    source: "人工整理",
    importedAt: new Date().toISOString(),
    entryCount: merged.length,
    note: "由 samples/目录收录候选.md 的型号清单人工核对录入",
  },
  entries: merged,
};
writeFileSync(manualPath, JSON.stringify(payload), { encoding: "utf8" });

// 4. 审计落库
const runId = recordCatalogImportRun({
  upstreamCommit: "manual",
  upstreamUrl: null,
  license: "n/a（人工整理）",
  sourcePath: fileArg,
  filesRead: 1,
  importedCount: merged.length,
  skippedCount: 0,
  errorCount: allErrors.length,
  errors: [],
});

console.log(`导入完成：新增 ${added} 条，更新 ${updated} 条，人工目录共 ${merged.length} 条。`);
console.log(`目录文件：${manualPath}`);
console.log(`审计记录：catalog_import_runs / ${runId}`);
console.log("重启 dev server 后生效（目录按进程缓存）。");
