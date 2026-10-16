import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * hw-agent 新版 CSV 输出 → 导入管道 JSON（data/catalog/hwagent/*_full.json）。
 *
 * 背景：hw-agent 采集工具的新输出是按类目拆分的 CSV（文档1-CPU处理器.csv 等），
 * 而导入管线（import-hwagent.ts → map.ts）吃 *_full.json。本脚本做纯格式转换：
 * - id 列与旧数据同 scheme（amd-9950x3d2…），已有行会走 writeCatalogMerge 刷新而非重复；
 * - 空单元格 → null（数据纪律：未查到就 null）；True/False → boolean；纯数字 → number；
 * - 竖线分隔列（aliases/power_conn/sockets/formfactors/mem_types）→ 数组；
 * - 键盘/鼠标/显示器（文档9-11）不在八类范围内，跳过并在报告注明。
 *
 * 用法：npx tsx scripts/convert-hwagent-csv.ts --src <CSV目录> [--out data/catalog/hwagent]
 */

const args = process.argv.slice(2);
const srcArg = args.indexOf("--src");
const srcDir = resolve(srcArg >= 0 ? args[srcArg + 1]! : "");
const outArg = args.indexOf("--out");
const outDir = resolve(outArg >= 0 ? args[outArg + 1]! : "data/catalog/hwagent");

if (!srcDir || !existsSync(srcDir)) {
  console.error("用法：npx tsx scripts/convert-hwagent-csv.ts --src <hw-agent output CSV 目录>");
  process.exit(1);
}

/** CSV 文件名 → 输出文件 + 数组键 + 数据集名 */
const MAPPING: Array<{ csv: string; out: string; key: string; dataset: string }> = [
  { csv: "文档1-CPU处理器.csv", out: "cpu_full.json", key: "cpus", dataset: "cpu_full" },
  { csv: "文档2-显卡.csv", out: "gpu_full.json", key: "gpus", dataset: "gpu_full" },
  { csv: "文档3-主板.csv", out: "mobo_full.json", key: "mobos", dataset: "mobo_full" },
  { csv: "文档4-内存.csv", out: "ram_ssd_full.json", key: "ram", dataset: "ram_ssd_full" },
  { csv: "文档5-固态硬盘.csv", out: "ram_ssd_full.json", key: "ssd", dataset: "ram_ssd_full" },
  { csv: "文档6-电源.csv", out: "psu_full.json", key: "psus", dataset: "psu_full" },
  { csv: "文档7-散热器.csv", out: "cooler_full.json", key: "coolers", dataset: "cooler_full" },
  { csv: "文档8-机箱.csv", out: "case_full.json", key: "cases", dataset: "case_full" },
];

const SKIPPED = ["文档9-显示器.csv", "文档10-键盘.csv", "文档11-鼠标.csv"];
const LIST_COLUMNS = new Set(["aliases", "power_conn", "sockets", "formfactors", "mem_types"]);

/** RFC4180 迷你解析：双引号转义、引号内逗号/换行、BOM */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const clean = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function convertValue(column: string, value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (LIST_COLUMNS.has(column)) return trimmed.split("|").map((part) => part.trim()).filter(Boolean);
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function convertFile(csvPath: string): { headers: string[]; records: Record<string, unknown>[] } {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const headers = rows[0]!.map((header) => header.trim());
  const records = rows.slice(1).map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = convertValue(header, row[index] ?? "");
    });
    return record;
  });
  return { headers, records };
}

// 汇总 ram_ssd（两个 CSV 合一个输出文件）
const ramSsd: { ram?: Record<string, unknown>[]; ssd?: Record<string, unknown>[] } = {};
const report: Array<{ file: string; count: number }> = [];

for (const mapping of MAPPING) {
  const csvPath = join(srcDir, mapping.csv);
  if (!existsSync(csvPath)) {
    console.error(`缺少数据文件：${csvPath}`);
    process.exit(1);
  }
  const { records } = convertFile(csvPath);
  const ids = new Set<string>();
  for (const record of records) {
    const id = String(record.id ?? "");
    if (id.length === 0) { console.error(`${mapping.csv} 存在无 id 行`); process.exit(1); }
    if (ids.has(id)) { console.error(`${mapping.csv} id 重复：${id}`); process.exit(1); }
    ids.add(id);
  }
  if (mapping.key === "ram" || mapping.key === "ssd") {
    ramSsd[mapping.key as "ram" | "ssd"] = records;
  } else {
    const collectedAt = srcDir.match(/(\d{4}-\d{2}-\d{2})-(\d{2}-\d{2}-\d{2})$/);
    const collected = collectedAt ? `${collectedAt[1]}T${collectedAt[2]!.replaceAll("-", ":")}` : null;
    const artifact = {
      _meta: { dataset: mapping.dataset, collected_at: collected, desc: `中国大陆市场 ${mapping.dataset} 规格库（hw-agent 采集，人工校验）` },
      [mapping.key]: records,
    };
    writeFileSync(join(outDir, mapping.out), `${JSON.stringify(artifact, null, 1)}\n`, "utf8");
    report.push({ file: mapping.out, count: records.length });
  }
  report.push({ file: `${mapping.csv} → ${mapping.out}:${mapping.key}`, count: records.length });
}

// ram_ssd 合并写（ram + ssd 同文件）
const ramMeta = { _meta: { dataset: "ram_ssd_full", collected_at: srcDir.match(/(\d{4}-\d{2}-\d{2})-(\d{2}-\d{2}-\d{2})$/)?.[1] ?? null } };
writeFileSync(join(outDir, "ram_ssd_full.json"), `${JSON.stringify({ ...ramMeta, ...ramSsd }, null, 1)}\n`, "utf8");

console.log(`转换完成 → ${outDir}`);
for (const item of report) console.log(`  ${item.file}: ${item.count} 条`);
const skippedNote = readdirSync(srcDir).filter((file) => SKIPPED.includes(file));
if (skippedNote.length > 0) console.log(`  跳过（八类范围外）：${skippedNote.join("、")}`);
