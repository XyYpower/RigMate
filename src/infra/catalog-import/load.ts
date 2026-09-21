import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { specSchemaByCategory } from "@/domain/build/specs";
import { buildItemCategorySchema } from "@/domain/build/types";
import type { CatalogEntry } from "@/domain/catalog/seed";

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

/** 合并人工种子与导入条目（种子在前，保证搜索上限截断时种子优先可见） */
export function mergedCatalogEntries(seed: CatalogEntry[]): CatalogEntry[] {
  const imported = loadBuildcoresCatalog();
  return imported ? [...seed, ...imported.entries] : seed;
}

export function resetBuildcoresCatalogCacheForTests(): void {
  cache = undefined;
}
