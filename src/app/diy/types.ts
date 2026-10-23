import type { CATEGORY_META } from "@/ui/category-form";
import type { ItemSpec } from "@/ui/category-form";
import type { BudgetSummary } from "@/domain/build/types";

export type Category = keyof typeof CATEGORY_META;

export type Item = {
  id: string;
  category: Category;
  label: string;
  /** 中文展示名（服务端按 source 里的目录 id 解析后附加）；缺失时回退 label */
  displayName?: string;
  displayNameOriginal?: string;
  spec: ItemSpec;
  priceCents?: number;
  source?: string;
};

export type Build = {
  id: string;
  name: string;
  useCase: string | null;
  status: string;
  updatedAt: string;
  budgetCents: number | null;
  budgetSummary?: BudgetSummary;
  items: Item[];
};

export type CategoryDraft = { label: string; price: string; catalogId?: string; fields: Record<string, string> };

export type CatalogEntry = {
  id: string;
  category: string;
  name: string;
  /** 中文展示名（服务端按目录解析后附加）；缺失时回退 name */
  displayName?: string;
  displayNameOriginal?: string;
  aliases: string[];
  spec: ItemSpec;
};

export type CatalogProvenance = {
  upstreamCommit: string;
  upstreamUrl: string;
  license: string;
  licenseUrl: string;
  importedAt: string;
  entryCount: number;
};

export const EMPTY_DRAFT: CategoryDraft = { label: "", price: "", fields: {} };

export function latestFirst(builds: Build[]): Build[] {
  return [...builds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatYuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}
