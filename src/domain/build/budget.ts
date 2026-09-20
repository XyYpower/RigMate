import type { BuildItem, BudgetSummary } from "./types";

/**
 * 业务规格 §10.1 预算汇总：区分已计价与未计价，未知金额不按零元计入。
 * 纯函数：只看传入数据，不读库、不调模型。
 */
export function computeBudgetSummary(
  budgetCents: number | null,
  items: Pick<BuildItem, "id" | "label" | "priceCents">[],
): BudgetSummary {
  const priced = items.filter((item) => typeof item.priceCents === "number");
  const unpriced = items.filter((item) => typeof item.priceCents !== "number");
  const pricedTotalCents = priced.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);

  return {
    budgetCents,
    pricedTotalCents,
    pricedCount: priced.length,
    unpricedCount: unpriced.length,
    unpricedLabels: unpriced.map((item) => item.label),
    differenceCents: budgetCents === null ? null : budgetCents - pricedTotalCents,
  };
}
