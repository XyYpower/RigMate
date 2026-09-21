import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { runImport } from "../src/infra/catalog-import/run";

/**
 * BuildCores 目录导入器 CLI：
 *   npm run import-catalog -- --source data/buildcores-open-db [--commit <sha>]
 *
 * 离线导入：读取本地克隆（不联网）。上游 commit 是审计硬要求（ADR §8.1-6 导入版本
 * 固定）——source 目录不是 git 克隆时必须用 --commit 显式指定，否则拒绝导入。
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourceRoot = resolve(argValue("--source") ?? "data/buildcores-open-db");
if (!existsSync(join(sourceRoot, "open-db"))) {
  console.error(`找不到 BuildCores OpenDB 数据：${sourceRoot}`);
  console.error("请先克隆上游仓库到本地：git clone --depth 1 https://github.com/buildcores/buildcores-open-db.git");
  process.exit(1);
}

let commit = argValue("--commit")?.trim();
if (!commit) {
  try {
    commit = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    console.error("无法确定上游 commit（source 目录不是 git 克隆）。");
    console.error("导入必须固定上游版本（ADR §8.1），请用 --commit <sha> 显式指定。");
    process.exit(1);
  }
}

console.log(`导入 BuildCores OpenDB @ ${commit.slice(0, 12)}（来源：${sourceRoot}）…`);

const summary = runImport({ sourceRoot, upstreamCommit: commit });

console.log(
  `完成：读取 ${summary.filesRead} 个文件 → 导入 ${summary.importedCount} 条，` +
    `跳过 ${summary.skippedCount} 条（无可映射规格），错误 ${summary.errorCount} 条。`,
);
for (const [category, counts] of Object.entries(summary.perCategory)) {
  console.log(
    `  ${category.padEnd(11)} 导入 ${String(counts.imported).padStart(5)} · 跳过 ${String(counts.skipped).padStart(4)} · 错误 ${counts.errors}`,
  );
}
if (summary.recordedErrors.length > 0) {
  console.log("错误样本（最多 20 条，全量见 catalog_import_runs 表）：");
  for (const message of summary.recordedErrors) console.log(`  - ${message}`);
}
console.log(`目录文件：${summary.outputPath}`);
console.log(`审计记录：catalog_import_runs / ${summary.importRunId}`);
console.log("署名：数据含 BuildCores OpenDB（ODC-By 1.0）内容，界面与文档须保留署名。");
if (summary.importedCount === 0) process.exit(1);
