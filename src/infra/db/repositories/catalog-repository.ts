import { asc, eq, sql } from "drizzle-orm";
import { specSchemaByCategory } from "@/domain/build/specs";
import { buildItemCategorySchema } from "@/domain/build/types";
import type { CatalogEntry } from "@/domain/catalog/seed";
import { canonicalProducts, ensureDatabase } from "../client";

/**
 * 自有规格库仓储（M29，ADR §8.1 canonical_products）。
 *
 * 纪律：
 * - 写入前逐条过类别 schema 校验（坏数据不上线，与 JSON 加载器同一道门）；
 * - 首次入库 first-wins：种子 → 人工 → BuildCores 顺序导入，同 id 先到先得（人工精选优先于批量）；
 * - 补缺更新（ZOL 等）只允许"填空"：已核字段绝不覆盖，ref_url 只在为空时写入，
 *   且目标 id 必须已存在——新品一律走人工目录确认流程，不允许数据源静默建条目。
 */

export type CatalogSourceTag = "seed" | "manual" | "buildcores" | "zol";

export type SourcedCatalogEntry = CatalogEntry & { source: CatalogSourceTag };

export type CatalogUpdateInput = {
  id: string;
  specPatch: Record<string, unknown>;
  refUrl?: string;
  aliases?: string[];
};

export type CatalogUpdateReport = {
  updated: number;
  unchanged: number;
  missingIds: string[];
};

const SOURCE_PRIORITY: Record<CatalogSourceTag, number> = {
  seed: 0,
  manual: 1,
  buildcores: 2,
  zol: 3,
};

function parseEntry(row: typeof canonicalProducts.$inferSelect): SourcedCatalogEntry {
  const category = buildItemCategorySchema.parse(row.category);
  return {
    id: row.id,
    category,
    name: row.name,
    aliases: JSON.parse(row.aliases) as string[],
    // 加载即校验：库里进了坏数据时在这里炸出来，而不是流向规则引擎
    spec: specSchemaByCategory[category].parse(JSON.parse(row.spec) as Record<string, unknown>),
    source: row.source as CatalogSourceTag,
    ...(row.refUrl ? { refUrl: row.refUrl } : {}),
  };
}

/** 全量读取，进程内缓存（目录在进程内不可变，与 JSON 加载器同一策略） */
let cache: SourcedCatalogEntry[] | undefined;

export function loadCatalogEntries(): SourcedCatalogEntry[] {
  if (cache) return cache;
  const rows = ensureDatabase()
    .select()
    .from(canonicalProducts)
    .orderBy(asc(canonicalProducts.name))
    .all();
  const entries = rows
    .map(parseEntry)
    .sort(
      (a, b) =>
        SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  cache = entries;
  return entries;
}

export function countCatalogEntries(): number {
  const row = ensureDatabase()
    .select({ count: sql<number>`count(*)` })
    .from(canonicalProducts)
    .get();
  return row?.count ?? 0;
}

function validateEntryInput(entry: CatalogEntry): void {
  // 写入前按类别 schema 复检：缺字段允许（unknown 纪律），坏字段拒绝
  specSchemaByCategory[entry.category].parse(entry.spec);
}

/**
 * 批量入库（初始化迁移用）。同 id 已存在则跳过（first-wins），
 * 导入方按 种子 → 人工 → BuildCores 顺序调用即可保持与三层合并一致的优先级。
 */
export function upsertCatalogEntries(entries: (CatalogEntry & { source: CatalogSourceTag })[]): {
  inserted: number;
  skipped: number;
} {
  const db = ensureDatabase();
  let inserted = 0;
  let skipped = 0;
  const timestamp = new Date().toISOString();
  for (const entry of entries) {
    validateEntryInput(entry);
    const result = db
      .insert(canonicalProducts)
      .values({
        id: entry.id,
        category: entry.category,
        name: entry.name,
        aliases: JSON.stringify(entry.aliases),
        spec: JSON.stringify(entry.spec),
        source: entry.source,
        refUrl: entry.refUrl ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoNothing()
      .run();
    if (result.changes > 0) inserted += 1;
    else skipped += 1;
  }
  if (inserted > 0) cache = undefined;
  return { inserted, skipped };
}

/**
 * 补缺更新（ZOL 等外部参数源）：只填目标条目缺失的字段，绝不覆盖已核值；
 * ref_url 只在为空时写入；目标 id 不存在时计入 missingIds 交人工处理。
 * 补丁本身先整体过 schema（哪怕目标字段已有值）——坏数据在门口炸出来，而不是被静默忽略。
 */
export function mergeCatalogUpdates(updates: CatalogUpdateInput[]): CatalogUpdateReport {
  const db = ensureDatabase();
  const report: CatalogUpdateReport = { updated: 0, unchanged: 0, missingIds: [] };
  const timestamp = new Date().toISOString();
  for (const update of updates) {
    const row = db
      .select()
      .from(canonicalProducts)
      .where(eq(canonicalProducts.id, update.id))
      .get();
    if (!row) {
      report.missingIds.push(update.id);
      continue;
    }
    const category = buildItemCategorySchema.parse(row.category);
    const currentSpec = JSON.parse(row.spec) as Record<string, unknown>;
    // 门禁一：并入补丁后整体校验——补丁值非法直接拒绝
    const validatedSpec = specSchemaByCategory[category].parse({
      ...currentSpec,
      ...update.specPatch,
    });
    // 门禁二：schema 不认识的补丁键 = 疑似拼写错误，拒绝（否则会被静默剥离、字段永远填不上）
    for (const key of Object.keys(update.specPatch)) {
      if (!(key in validatedSpec) && currentSpec[key] === undefined) {
        throw new Error(`补缺更新被拒绝：字段 "${key}" 不在 ${category} 规格 schema 中。`);
      }
    }
    // 应用纪律：已核字段不动，只补空位
    const mergedSpec: Record<string, unknown> = { ...currentSpec };
    for (const [key, value] of Object.entries(validatedSpec)) {
      if ((mergedSpec[key] === undefined || mergedSpec[key] === null) && value !== undefined) {
        mergedSpec[key] = value;
      }
    }
    const currentAliases = JSON.parse(row.aliases) as string[];
    const mergedAliases = update.aliases
      ? [...new Set([...currentAliases, ...update.aliases])]
      : currentAliases;
    const nextRefUrl = row.refUrl ?? update.refUrl ?? null;
    const changed =
      JSON.stringify(mergedSpec) !== JSON.stringify(currentSpec) ||
      mergedAliases.length !== currentAliases.length ||
      (nextRefUrl !== null && nextRefUrl !== row.refUrl);
    if (!changed) {
      report.unchanged += 1;
      continue;
    }
    db.update(canonicalProducts)
      .set({
        spec: JSON.stringify(mergedSpec),
        aliases: JSON.stringify(mergedAliases),
        refUrl: nextRefUrl,
        updatedAt: timestamp,
      })
      .where(eq(canonicalProducts.id, update.id))
      .run();
    report.updated += 1;
  }
  if (report.updated > 0) cache = undefined;
  return report;
}

export function resetCatalogDbCacheForTests(): void {
  cache = undefined;
}
