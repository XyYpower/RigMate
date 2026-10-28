import type { ReferencePriceItem } from "@/contracts/design";
import type { ProposalItem } from "@/contracts/design";

/**
 * 参考价映射（独立估算层，规格 v1 §价格）：把 proposal 级的 referencePrices
 * 按类别匹配到清单行。只在行没有真实价格（priceCents 为空）时才有意义；
 * 匹配顺序：productName 精确命中 > 类别命中（同类取第一条，估算不需要同类多价）。
 */
export function referencePriceForItem(
  item: Pick<ProposalItem, "category" | "label">,
  prices: readonly ReferencePriceItem[],
): ReferencePriceItem | null {
  if (prices.length === 0) return null;
  const byProduct = prices.find(
    (price) => price.productName && (item.label.includes(price.productName) || price.productName.includes(item.label)),
  );
  if (byProduct) return byProduct;
  return prices.find((price) => price.category === item.category) ?? null;
}

/**
 * 参考价守卫（数据纪律：错值比缺字段危险）：有预算时，单件参考价高于整机预算
 * 说明模型估算与方案明显矛盾（也可能是选件失衡的信号——那由核验台负责），
 * 这类参考价没有展示价值，直接丢弃。
 */
export function guardReferencePrices(
  prices: readonly ReferencePriceItem[],
  budgetCents: number | null,
): ReferencePriceItem[] {
  if (budgetCents === null || budgetCents <= 0) return [...prices];
  return prices.filter((price) => price.priceCents <= budgetCents);
}

/** 估算展示文案：永远带"参考/估算"字样，绝不伪装成已审核价格 */
export function formatReferencePrice(price: ReferencePriceItem): string {
  return `参考 ~¥${(price.priceCents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}
