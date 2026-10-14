import type { BuildItemCategory } from "../build/types";
import { localizeProductName } from "./localization";
import type { CatalogEntry } from "./seed";

/**
 * 目录检索：按类别过滤 + 名称/别名/**中文展示名**模糊包含（大小写不敏感），限制返回条数。
 *
 * 两个必须做对的细节：
 *
 * 1. 必须匹配本地化后的中文名。界面上写"微星 GeForce…"，用户搜的就是"微星"，
 *    只匹配 name/aliases（这里是 MSI）会让中文用户一条都搜不到。
 *
 * 2. 必须匹配**未截断**的展示名。界面显示的可能是截断版（"金士顿 FURY Beast"），
 *    也可能是因同类别撞车而回退的完整版（"…FURY Beast 6000MT/s 32GB (2x16GB)"）。
 *    截断只删尾部 token，所以完整版是截断版的严格超集——只匹配完整版，
 *    两种展示模式下界面上看得见的字就一定搜得到。
 */
export function searchCatalog(
  entries: CatalogEntry[],
  category: BuildItemCategory,
  query: string | null,
  limit = 30,
): CatalogEntry[] {
  const q = query?.trim().toLowerCase() ?? "";
  if (!q) {
    return entries.filter((entry) => entry.category === category).slice(0, limit);
  }
  const matches = (entry: CatalogEntry): boolean =>
    entry.name.toLowerCase().includes(q) ||
    entry.nameZh?.toLowerCase().includes(q) === true ||
    entry.aliases.some((alias) => alias.toLowerCase().includes(q)) ||
    localizeProductName(entry.name, entry.nameZh, { trim: false })
      .display.toLowerCase()
      .includes(q);
  return entries.filter((entry) => entry.category === category && matches(entry)).slice(0, limit);
}

export function findCatalogEntry(
  entries: CatalogEntry[],
  category: BuildItemCategory,
  id: string,
): CatalogEntry | undefined {
  return entries.find((entry) => entry.category === category && entry.id === id);
}
