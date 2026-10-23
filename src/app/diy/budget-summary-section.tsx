import { formatYuan } from "./types";
import type { BudgetSummary } from "@/domain/build/types";

/** 数据行 + 余量尺：未计价件永不按零元计入（斜纹区间如实呈现） */
export function BudgetSummarySection({ summary, itemCount }: { summary: BudgetSummary; itemCount: number }) {
  const hasBudget = summary.budgetCents !== null && summary.budgetCents > 0;
  const budget = summary.budgetCents ?? 0;
  const ratio = hasBudget ? Math.min(summary.pricedTotalCents / budget, 1) : 0;
  const over = hasBudget && summary.pricedTotalCents > budget;
  const difference = summary.differenceCents ?? null;

  return (
    <>
      <section className="dataline">
        <span className="stat">
          <span className="stat-label">预算</span>
          <span className={`stat-value ${hasBudget ? "" : "muted"}`}>{hasBudget ? formatYuan(budget) : "未设置"}</span>
        </span>
        <span className="stat">
          <span className="stat-label">已计价</span>
          <span className="stat-value accent">{formatYuan(summary.pricedTotalCents)}</span>
          <span className="stat-sub">{summary.pricedCount} / {itemCount} 件</span>
        </span>
        <span className="stat">
          <span className="stat-label">未计价</span>
          <span className="stat-value">{summary.unpricedCount} 件</span>
          <span className="stat-sub">不按零元计入</span>
        </span>
        <span className="stat">
          <span className="stat-label">{over ? "超支" : "余量"}</span>
          <span className={`stat-value ${over ? "over" : ""} ${difference === null ? "muted" : ""}`}>
            {difference === null ? "—" : `${difference < 0 ? "−" : ""}${formatYuan(Math.abs(difference))}`}
          </span>
        </span>
      </section>
      {hasBudget ? (
        <section className="ruler">
          <div className="ruler-bar" role="img" aria-label={`预算 ${formatYuan(budget)}，已计价 ${formatYuan(summary.pricedTotalCents)}`}>
            {summary.unpricedCount > 0 && <div className="ruler-ghost" aria-hidden />}
            <div className={`ruler-fill ${over ? "over" : ""}`} style={{ width: `${ratio * 100}%` }} />
          </div>
          <div className="ruler-scale" aria-hidden>
            <span>0</span><span>25%</span><span>50%</span><span>75%</span><span>{formatYuan(budget)}</span>
          </div>
        </section>
      ) : (
        <p className="note-line">该项目未设置预算：新建项目时填写「预算（元）」即可显示余量尺；未计价件永远不按零元计入。</p>
      )}
      {hasBudget && summary.unpricedCount > 0 && (
        <p className="note-line ghost">
          斜纹区间 = 未计价 {summary.unpricedCount} 件（{summary.unpricedLabels.join("、")}），补价后差额会变化。
        </p>
      )}
    </>
  );
}
