import { describe, expect, it } from "vitest";
import { computeBudgetSummary } from "@/domain/build/budget";
import type { BuildItem } from "@/domain/build/types";

function item(label: string, priceCents?: number): BuildItem {
  return {
    id: label,
    buildId: "build-1",
    category: "cpu",
    label,
    spec: {},
    priceCents,
    createdAt: new Date().toISOString(),
  } as BuildItem;
}

describe("预算汇总（业务规格 §10.1）", () => {
  it("全部已计价：总额与差额正确", () => {
    const summary = computeBudgetSummary(800_00, [
      item("CPU", 200_00),
      item("主板", 100_00),
      item("显卡", 300_00),
    ]);
    expect(summary.pricedTotalCents).toBe(600_00);
    expect(summary.differenceCents).toBe(200_00);
    expect(summary.unpricedCount).toBe(0);
  });

  it("未计价件不按零元计入总额，单独列出", () => {
    const summary = computeBudgetSummary(800_00, [
      item("CPU", 200_00),
      item("显卡"),
      item("机箱"),
    ]);
    expect(summary.pricedTotalCents).toBe(200_00);
    expect(summary.unpricedCount).toBe(2);
    expect(summary.unpricedLabels).toEqual(["显卡", "机箱"]);
    expect(summary.differenceCents).toBe(600_00);
  });

  it("未设置预算时差额为 null，但总额照常计算", () => {
    const summary = computeBudgetSummary(null, [item("CPU", 200_00)]);
    expect(summary.budgetCents).toBeNull();
    expect(summary.pricedTotalCents).toBe(200_00);
    expect(summary.differenceCents).toBeNull();
  });

  it("超预算时差额为负数", () => {
    const summary = computeBudgetSummary(500_00, [
      item("CPU", 300_00),
      item("显卡", 300_00),
    ]);
    expect(summary.differenceCents).toBe(-100_00);
  });

  it("空清单或全未计价：总额为零，不产生虚假结论", () => {
    const empty = computeBudgetSummary(800_00, []);
    expect(empty.pricedTotalCents).toBe(0);
    expect(empty.differenceCents).toBe(800_00);

    const allUnpriced = computeBudgetSummary(800_00, [item("CPU"), item("显卡")]);
    expect(allUnpriced.pricedTotalCents).toBe(0);
    expect(allUnpriced.unpricedCount).toBe(2);
  });
});
