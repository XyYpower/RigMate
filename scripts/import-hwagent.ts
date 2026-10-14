import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  arrayKeyOf,
  HWAGENT_FILES,
  HWAGENT_SOURCE_VERSION,
  mapHwagentRecord,
  ssdArrayOf,
  type MappedEntry,
} from "../src/infra/catalog-import/hwagent/map";
import { upsertCatalogEntries, writeCatalogMerge } from "../src/infra/db/repositories/catalog-repository";
import { recordCatalogImportRun } from "../src/infra/db/repositories/catalog-import-repository";
import { closeDatabase, ensureDatabase } from "../src/infra/db/client";

/**
 * hw-agent 精选规格库导入（723 型号，data/catalog/hwagent/）。
 *
 * 默认 dry-run：全量映射校验 + 报告 + 写 data/catalog/hwagent.json（provenance 审计产物）。
 * --db：额外写入 canonical_products（source=hwagent，qualityStatus=supported——
 * 厂商官网来源 + 人工校验 + 十项质量校验，够候选池门槛；verified 留给证据链盖章流程）。
 *
 * 前置：catalog-repository 的 SOURCE_PRIORITY 中 hwagent 优先级高于 buildcores/zol，
 * 导入后旧来源数据需跑 `catalog:archive-legacy` 降级归档，候选池才会只剩精选库。
 */

const DATA_DIR = "data/catalog/hwagent";
const OUT_JSON = "data/catalog/hwagent.json";

type RawFile = { _meta?: { collected_at?: string; dataset?: string } };

function loadAll(): { entries: MappedEntry[]; collectedAt: string | null } {
  let collectedAt: string | null = null;
  const entries: MappedEntry[] = [];
  const seen = new Set<string>();
  for (const file of HWAGENT_FILES) {
    const path = join(DATA_DIR, file);
    if (!existsSync(path)) throw new Error(`缺少数据文件：${path}`);
    const data = JSON.parse(readFileSync(path, "utf8")) as RawFile & Record<string, unknown>;
    const collected = data._meta?.collected_at;
    if (typeof collected === "string" && collected > (collectedAt ?? "")) collectedAt = collected;
    const lists: Array<[string, unknown[], string]> = [];
    const { key, hwCategory } = arrayKeyOf(file);
    lists.push([key, Array.isArray(data[key]) ? (data[key] as unknown[]) : [], hwCategory]);
    if (file === "ram_ssd_full.json") lists.push(["ssd", ssdArrayOf(data), "storage"]);
    for (const [, records, category] of lists) {
      for (const record of records) {
        const raw = record as Record<string, unknown>;
        const sourceId = String(raw.id ?? "");
        if (sourceId.length === 0) throw new Error(`${file} 存在无 id 条目`);
        if (seen.has(sourceId)) throw new Error(`hwagent 数据集内部 id 重复：${sourceId}`);
        seen.add(sourceId);
        entries.push(mapHwagentRecord(record, sourceId, category as never));
      }
    }
  }
  return { entries, collectedAt };
}

function contentHashOf(entries: MappedEntry[]): string {
  const canonical = entries
    .map((entry) => JSON.stringify([entry.id, entry.category, entry.name, entry.aliases, entry.spec, entry.nameZh]))
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function writeArtifact(entries: MappedEntry[], collectedAt: string | null): void {
  const artifact = {
    provenance: {
      source: "hw-agent 精选规格库（品牌官网规格页 / 官方 PDF / 京东规格实采，人工校验）",
      collectedAt: collectedAt ?? HWAGENT_SOURCE_VERSION,
      sourceVersion: HWAGENT_SOURCE_VERSION,
      license: "项目内部使用",
      importedAt: new Date().toISOString(),
      entryCount: entries.length,
      contentHash: contentHashOf(entries),
      fieldMapping: "src/infra/catalog-import/hwagent/map.ts",
    },
    entries: entries.map(({ id, category, name, aliases, spec }) => ({ id, category, name, aliases, spec })),
  };
  writeFileSync(OUT_JSON, JSON.stringify(artifact, null, 1), "utf8");
  console.log(`审计产物已写：${OUT_JSON}（contentHash ${artifact.provenance.contentHash.slice(0, 12)}…）`);
}

function importToDb(entries: MappedEntry[], collectedAt: string | null): void {
  ensureDatabase();
  const result = upsertCatalogEntries(
    entries.map((entry) => ({
      id: entry.id,
      category: entry.category,
      name: entry.name,
      aliases: entry.aliases,
      spec: entry.spec,
      source: "hwagent" as const,
      nameZh: entry.nameZh,
      qualityStatus: "supported" as const,
      sourceVersion: HWAGENT_SOURCE_VERSION,
      manufacturer: null,
    })),
  );
  // 重导刷新：hw-* 行由本脚本自有（同 cn/import.ts 对自动来源的语义），spec 整体替换
  // 保证数据集更新（如补 perf_score）能落到已存在行上
  for (const entry of entries) {
    writeCatalogMerge(entry.id, entry.spec, "supported", HWAGENT_SOURCE_VERSION);
  }
  recordCatalogImportRun({
    upstreamCommit: HWAGENT_SOURCE_VERSION,
    upstreamUrl: null,
    license: "项目内部使用",
    sourcePath: DATA_DIR,
    filesRead: HWAGENT_FILES.length,
    importedCount: result.inserted,
    skippedCount: result.skipped,
    errorCount: 0,
    errors: [],
  });
  console.log(`DB 写入：inserted=${result.inserted} skipped=${result.skipped}（first-wins，collectedAt=${collectedAt ?? HWAGENT_SOURCE_VERSION}）`);
}

const writeDb = process.argv.includes("--db");
const { entries, collectedAt } = loadAll();
const byCategory = new Map<string, number>();
for (const entry of entries) byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1);
console.log(`映射成功 ${entries.length} 条：`, [...byCategory.entries()].map(([k, v]) => `${k}=${v}`).join(" "));
writeArtifact(entries, collectedAt);
if (writeDb) {
  importToDb(entries, collectedAt);
} else {
  console.log("（dry-run，未写库；加 --db 写入 canonical_products）");
}
closeDatabase();
