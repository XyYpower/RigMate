import type { BuildItemCategory } from "../build/types";
import type { CatalogEntry } from "./seed";

/** 目录检索：按类别过滤 + 名称/别名模糊包含（大小写不敏感），限制返回条数 */
export function searchCatalog(
  entries: CatalogEntry[],
  category: BuildItemCategory,
  query: string | null,
  limit = 30,
): CatalogEntry[] {
  const q = query?.trim().toLowerCase() ?? "";
  return entries
    .filter((entry) => entry.category === category)
    .filter(
      (entry) =>
        !q ||
        entry.name.toLowerCase().includes(q) ||
        entry.aliases.some((alias) => alias.toLowerCase().includes(q)),
    )
    .slice(0, limit);
}

export function findCatalogEntry(
  entries: CatalogEntry[],
  category: BuildItemCategory,
  id: string,
): CatalogEntry | undefined {
  return entries.find((entry) => entry.category === category && entry.id === id);
}
