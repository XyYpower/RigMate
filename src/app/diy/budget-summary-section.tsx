import { formatYuan } from "./types";
import type { BudgetSummary } from "@/domain/build/types";

/**
 * 数据行 + 余量尺（DESIGN.md v3 原则 2：结构优先于解释）——
 * 图例内联在标尺下方（色样=已计价，斜纹=未计价），不再用整段 note-line 口头解释。
 * 「未计价 N 件」短语被 e2e 断言，保留。
 */
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
          <div className="ruler-bar" role="img" aria-label={`预算 ${formatYuan(budget)}，已计价 ${formatYuan(summary.pricedTotalCents)}，未计价 ${summary.unpricedCount} 件`}>
            {summary.unpricedCount > 0 && <div className="ruler-ghost" aria-hidden />}
            <div className={`ruler-fill ${over ? "over" : ""}`} style={{ width: `${ratio * 100}%` }} />
          </div>
          <div className="ruler-scale" aria-hidden>
            <span>0</span><span>25%</span><span>50%</span><span>75%</span><span>{formatYuan(budget)}</span>
          </div>
          {summary.unpricedCount > 0 && (
            <p className="ruler-legend">
              <span className="ruler-legend-item"><i className="ruler-legend-fill" aria-hidden />已计价</span>
              <span className="ruler-legend-item"><i className="ruler-legend-ghost" aria-hidden />未计价 {summary.unpricedCount} 件（{summary.unpricedLabels.join("、")}）</span>
            </p>
          )}
        </section>
      ) : (
        <p className="note-line">未设置预算：新建项目时填写「预算（元）」就会出现余量尺。</p>
      )}
    </>
  );
}
