import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { specSchemaByCategory } from "@/domain/build/specs";
import { buildItemCategorySchema } from "@/domain/build/types";
import { CATALOG as CATALOG_SEED, type CatalogEntry } from "@/domain/catalog/seed";
import { loadCatalogEntries, resetCatalogDbCacheForTests } from "@/infra/db/repositories/catalog-repository";
import { manualCatalogFileSchema } from "./manual-csv";

/**
 * 运行时加载 BuildCores 导入产物（data/catalog/buildcores.json，gitignore——
 * 与数据库一样属于本地数据层）。文件不存在 = 尚未导入，返回 null，目录只剩人工种子。
 *
 * 数据纪律与种子目录一致：加载即按类别 schema 校验，坏条目直接抛错（坏数据不上线）。
 */

export type BuildcoresProvenance = {
  upstreamCommit: string;
  upstreamUrl: string;
  license: string;
  licenseUrl: string;
  importedAt: string;
  entryCount: number;
};

export type BuildcoresCatalog = {
  provenance: BuildcoresProvenance;
  entries: CatalogEntry[];
};

const buildcoresFileSchema = z.object({
  provenance: z.object({
    upstreamCommit: z.string().min(1),
    upstreamUrl: z.string().min(1),
    license: z.string().min(1),
    licenseUrl: z.string().min(1),
    importedAt: z.string().min(1),
    entryCount: z.number().int().nonnegative(),
  }),
  entries: z.array(
    z.object({
      id: z.string().min(1),
      category: buildItemCategorySchema,
      name: z.string().min(1),
      aliases: z.array(z.string()),
      spec: z.record(z.string(), z.unknown()),
    }),
  ),
});

/** 路径在调用时解析（测试可通过 env 指向临时文件） */
function resolveCatalogFilePath(): string {
  return process.env.RIGMATE_BUILDCORES_CATALOG_PATH
    ? resolve(process.env.RIGMATE_BUILDCORES_CATALOG_PATH)
    : join(process.cwd(), "data", "catalog", "buildcores.json");
}

let cache: BuildcoresCatalog | null | undefined;

/** 读取导入产物；未导入过返回 null。结果按进程缓存（目录数据在进程内不可变） */
export function loadBuildcoresCatalog(): BuildcoresCatalog | null {
  if (cache !== undefined) return cache;
  const catalogFilePath = resolveCatalogFilePath();
  if (!existsSync(catalogFilePath)) {
    cache = null;
    return cache;
  }
  const raw = JSON.parse(readFileSync(catalogFilePath, "utf8")) as unknown;
  const file = buildcoresFileSchema.parse(raw);
  const entries: CatalogEntry[] = file.entries.map((entry) => ({
    ...entry,
    spec: specSchemaByCategory[entry.category].parse(entry.spec),
  }));
  if (entries.length !== file.provenance.entryCount) {
    throw new Error(
      `BuildCores 目录文件自相矛盾：实际 ${entries.length} 条，provenance 记录 ${file.provenance.entryCount} 条`,
    );
  }
  cache = { provenance: file.provenance, entries };
  return cache;
}

export type ManualCatalog = {
  provenance: { source: string; importedAt: string; entryCount: number; note?: string };
  entries: CatalogEntry[];
};

let manualCache: ManualCatalog | null | undefined;

function resolveManualCatalogFilePath(): string {
  return process.env.RIGMATE_MANUAL_CATALOG_PATH
    ? resolve(process.env.RIGMATE_MANUAL_CATALOG_PATH)
    : join(process.cwd(), "data", "catalog", "manual.json");
}

/** 读取人工目录（M20 批量导入产物）；从未导入过返回 null */
export function loadManualCatalog(): ManualCatalog | null {
  if (manualCache !== undefined) return manualCache;
  const manualPath = resolveManualCatalogFilePath();
  if (!existsSync(manualPath)) {
    manualCache = null;
    return manualCache;
  }
  const raw = JSON.parse(readFileSync(manualPath, "utf8")) as unknown;
  const file = manualCatalogFileSchema.parse(raw);
  const entries: CatalogEntry[] = file.entries.map((entry) => ({
    ...entry,
    spec: specSchemaByCategory[entry.category].parse(entry.spec),
  }));
  if (entries.length !== file.provenance.entryCount) {
    throw new Error(
      `人工目录文件自相矛盾：实际 ${entries.length} 条，provenance 记录 ${file.provenance.entryCount} 条`,
    );
  }
  manualCache = { provenance: file.provenance, entries };
  return manualCache;
}

/** 合并三层目录：人工种子 → 人工批量导入 → BuildCores（无关键词下拉里越靠前越相关） */
export function mergedCatalogEntries(seed: CatalogEntry[]): CatalogEntry[] {
  const imported = loadBuildcoresCatalog();
  const manual = loadManualCatalog();
  return [...seed, ...(manual?.entries ?? []), ...(imported?.entries ?? [])];
}

/**
 * 统一目录入口（M29）：自有规格库（canonical_products 表）优先；
 * 库为空（未跑过入库/全新 e2e 库）时回退到 JSON 三层合并，行为与历史版本一致。
 */
export function loadSourcedCatalog(): {
  entries: (CatalogEntry & { source: "seed" | "manual" | "buildcores" | "zol" })[];
  dbBacked: boolean;
} {
  const dbEntries = loadCatalogEntries();
  if (dbEntries.length > 0) return { entries: dbEntries, dbBacked: true };
  const manual = loadManualCatalog();
  const buildcores = loadBuildcoresCatalog();
  return {
    entries: [
      ...CATALOG_SEED.map((entry) => ({ ...entry, source: "seed" as const })),
      ...(manual?.entries ?? []).map((entry) => ({ ...entry, source: "manual" as const })),
      ...(buildcores?.entries ?? []).map((entry) => ({ ...entry, source: "buildcores" as const })),
    ],
    dbBacked: false,
  };
}

export function resetBuildcoresCatalogCacheForTests(): void {
  cache = undefined;
  manualCache = undefined;
  resetCatalogDbCacheForTests();
}
