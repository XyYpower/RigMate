import { localizeProductName, resolveDisplayNames, type DisplayNameBasis } from "@/domain/catalog/localization";
import { loadSourcedCatalog } from "./load";

/**
 * 中文展示名解析（server 侧）。
 *
 * 客户端组件不能直接读目录（loadSourcedCatalog 依赖 better-sqlite3，只在服务端可用），
 * 所以本地化统一在 API / 服务层完成，把结果挂到响应里，客户端只负责渲染。
 *
 * 落点是**展示层字段**：label / name 仍是身份与证据链的锚，一个字都不改。
 * 解析不到目录条目时原样返回用户输入，绝不猜。
 */

const CATALOG_SOURCE_PREFIX = "catalog:";

export type DisplayFields = {
  /** 界面主显示文本（中文优先；无中文名时等于原名） */
  displayName: string;
  /** 英文原名，供 title 悬停与溯源 */
  displayNameOriginal: string;
  /** 中文名来源，UI 据此决定是否标注"官网中文名" */
  displayNameBasis: DisplayNameBasis;
};

let index: Map<string, DisplayFields> | undefined;

/**
 * catalogId → 中文展示名。目录在进程内不可变（见 load.ts），索引同样只建一次。
 *
 * 用 resolveDisplayNames 走碰撞回退：同类别内若截断后撞车，自动放弃截断。
 */
export function catalogDisplayIndex(): Map<string, DisplayFields> {
  if (index) return index;
  const { entries } = loadSourcedCatalog();
  index = new Map(
    resolveDisplayNames(entries, (entry) => entry.category).map((entry) => [
      entry.id,
      {
        displayName: entry.displayName,
        displayNameOriginal: entry.displayNameOriginal,
        displayNameBasis: entry.displayNameBasis,
      } satisfies DisplayFields,
    ]),
  );
  return index;
}

export function resetDisplayIndexCacheForTests(): void {
  index = undefined;
}

/** build_items.source 形如 "catalog:{id}"；用户手填的配件没有这个前缀 */
export function catalogIdFromSource(source?: string | null): string | null {
  if (!source || !source.startsWith(CATALOG_SOURCE_PREFIX)) return null;
  const id = source.slice(CATALOG_SOURCE_PREFIX.length).trim();
  return id === "" ? null : id;
}

/** 查不到时返回 null，由调用方决定如何诚实降级 */
export function displayForCatalogId(catalogId?: string | null): DisplayFields | null {
  if (!catalogId) return null;
  return catalogDisplayIndex().get(catalogId) ?? null;
}

type CatalogNamed = { id: string; category: string; name: string; nameZh?: string | null };

/**
 * 目录条目列表挂展示字段（/api/catalog、/hardware 检索、DIY 下拉、复核候选）。
 *
 * 碰撞检测的作用域就是这次传进来的列表——/api/catalog 一次只返回一个类别，
 * 因此这里等价于"整个类别内检测"，与 DIY 下拉实际渲染的 30 条一致。
 */
export function decorateCatalogEntries<T extends CatalogNamed>(entries: readonly T[]) {
  return resolveDisplayNames(entries, (entry) => entry.category);
}

/** 方案项挂展示字段（proposal_items.catalog_id）。同一次方案内最多每类 1 件，无需再按类别分组 */
export function decorateProposalItems<T extends { label: string; catalogId?: string | null }>(
  items: readonly T[],
): (T & DisplayFields)[] {
  return items.map((item) => {
    const display = displayForCatalogId(item.catalogId);
    return {
      ...item,
      displayName: display?.displayName ?? item.label,
      displayNameOriginal: display?.displayNameOriginal ?? item.label,
      displayNameBasis: display?.displayNameBasis ?? "en_only",
    };
  });
}

/**
 * 配件挂展示字段（build_items.source = "catalog:{id}"）。
 *
 * source 里没有目录 id = 用户手填的型号，原样显示——用户自己写的字不该被本地化改写。
 */
export function decorateBuildItems<T extends { label: string; source?: string | null }>(
  items: readonly T[],
): (T & DisplayFields)[] {
  return items.map((item) => {
    const display = displayForCatalogId(catalogIdFromSource(item.source));
    return {
      ...item,
      displayName: display?.displayName ?? item.label,
      displayNameOriginal: display?.displayNameOriginal ?? item.label,
      displayNameBasis: display?.displayNameBasis ?? "en_only",
    };
  });
}

export { localizeProductName };
