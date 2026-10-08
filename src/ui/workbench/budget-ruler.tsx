import type { DesignProposal } from "@/contracts/design";
import { formatYuanParts } from "./format";
import type { BudgetRulerView } from "./types";

/**
 * 预算标尺（DESIGN.md §6 BudgetRuler）：预算线 + 估算区间 + 中值。
 * 只消费 BudgetRulerView；无预算显示"未设置预算"，不把 0 当预算。
 * 标尺状态同时用文字、位置和颜色表达，并提供整体文本替代。
 */

const STATE_LABEL = {
  unknown: "无法判断",
  within: "估算在预算内",
  crossing: "估算区间跨过预算线",
  over: "估算超出预算",
} as const;

/** 空标尺：首页无方案时使用 */
export function emptyBudgetRulerView(): BudgetRulerView {
  return { budgetCents: null, lowCents: null, highCents: null, midpointCents: null, state: "unknown" };
}

/** DesignProposal → 标尺视图：预算缺失或估算缺失都是 unknown，不猜 */
export function budgetRulerFrom(proposal: DesignProposal): BudgetRulerView {
  const low = proposal.estimatedLowCents;
  const high = proposal.estimatedHighCents;
  if (proposal.budgetCents === null || low === null || high === null) {
    return {
      budgetCents: proposal.budgetCents,
      lowCents: low,
      highCents: high,
      midpointCents: null,
      state: "unknown",
    };
  }
  const state = low > proposal.budgetCents ? "over" : high > proposal.budgetCents ? "crossing" : "within";
  return {
    budgetCents: proposal.budgetCents,
    lowCents: low,
    highCents: high,
    midpointCents: Math.round((low + high) / 2),
    state,
  };
}

function describeView(view: BudgetRulerView): string {
  const parts: string[] = [];
  parts.push(view.budgetCents !== null ? `预算 ${formatYuanParts(view.budgetCents)}` : "未设置预算");
  if (view.lowCents !== null && view.highCents !== null) {
    parts.push(`估算 ${formatYuanParts(view.lowCents)} 至 ${formatYuanParts(view.highCents)}`);
  } else {
    parts.push("估算待生成");
  }
  if (view.midpointCents !== null) parts.push(`中值 ${formatYuanParts(view.midpointCents)}`);
  parts.push(view.budgetCents === null ? "未设置预算" : STATE_LABEL[view.state]);
  return `预算标尺：${parts.join("；")}`;
}

export function BudgetRuler({ view }: { view: BudgetRulerView }) {
  const hasScale = view.budgetCents !== null && view.lowCents !== null && view.highCents !== null;
  const scaleMin = hasScale
    ? Math.min(view.budgetCents!, view.lowCents!)
    : 0;
  const scaleMax = hasScale
    ? Math.max(view.budgetCents!, view.highCents!)
    : 1;
  const span = Math.max(scaleMax - scaleMin, 1);
  const pct = (cents: number) => ((cents - scaleMin) / span) * 100;

  return (
    <section
      className={`budget-ruler ruler-${view.state}`}
      aria-label={describeView(view)}
    >
      <div className="budget-ruler-head">
        <h2>预算标尺</h2>
        <span className={`budget-ruler-state state-${view.state}`}>
          {view.budgetCents === null ? "未设置预算" : STATE_LABEL[view.state]}
        </span>
      </div>
      <div className="budget-ruler-track" aria-hidden={hasScale ? undefined : true}>
        {hasScale ? (
          <>
            <span
              className="budget-ruler-estimate"
              style={{ left: `${pct(view.lowCents!)}%`, width: `${pct(view.highCents!) - pct(view.lowCents!)}%` }}
            />
            <span
              className="budget-ruler-midpoint"
              style={{ left: `${pct(view.midpointCents ?? view.lowCents!)}%` }}
            />
            <span className="budget-ruler-budgetline" style={{ left: `${pct(view.budgetCents!)}%` }} />
          </>
        ) : (
          <span className="budget-ruler-empty-line" />
        )}
      </div>
      <p className="budget-ruler-figures">
        {view.budgetCents !== null ? (
          <span className="budget-ruler-budget">预算 {formatYuanParts(view.budgetCents)}</span>
        ) : (
          <span className="budget-ruler-budget">预算未设置</span>
        )}
        {view.lowCents !== null && view.highCents !== null ? (
          <span className="budget-ruler-range">
            估算 {formatYuanParts(view.lowCents)} – {formatYuanParts(view.highCents)}
          </span>
        ) : (
          <span className="budget-ruler-range">估算待生成</span>
        )}
      </p>
    </section>
  );
}
