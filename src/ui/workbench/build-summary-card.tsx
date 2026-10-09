import type { DesignProposal } from "@/contracts/design";
import { formatYuanParts } from "./format";

const FALLBACK_TAGS = ["平台兼容优先", "预算内取舍", "可继续调整"];

/** 特性标签：从真实 fitNotes 提取短语，不足时用中性兜底（不编造卖点） */
function extractTags(fitNotes: string[]): string[] {
  const tags = fitNotes
    .map((note) => note.replace(/[：:。].*$/, "").trim())
    .filter((tag) => tag.length > 0 && tag.length <= 12);
  return [...new Set(tags)].slice(0, 4);
}

/** 价格口径说明：有价格看证据占比，全无价格诚实说"暂无已审核价格证据" */
function priceBasisNote(proposal: DesignProposal): string {
  const priced = proposal.items.filter((item) => item.priceEstimateLowCents !== null && item.priceEstimateHighCents !== null);
  if (priced.length === 0) return "暂无已审核价格证据";
  const allEvidence = priced.every((item) => item.priceBasis === "evidence");
  return allEvidence
    ? "价格来自已审核证据，非实时成交价"
    : "价格含估算成分，非实时成交价";
}

/**
 * 推荐摘要卡（参考图：浅橙底摘要区）。
 * 诚实边界：总价只汇总已审核证据价格并明示区间；特性标签来自 fitNotes；无机箱渲染图。
 */
export function BuildSummaryCard({ proposal }: { proposal: DesignProposal }) {
  const low = proposal.estimatedLowCents;
  const high = proposal.estimatedHighCents;
  const midpoint = low !== null && high !== null ? Math.round((low + high) / 2) : null;
  const tags = extractTags(proposal.fitNotes);

  return (
    <section className="build-summary" aria-label="方案摘要">
      <div className="build-summary-main">
        <span className="build-summary-badge">推荐</span>
        <h2>{proposal.title}</h2>
        <p>{proposal.summary}</p>
        <div className="build-summary-tags">
          {(tags.length > 0 ? tags : FALLBACK_TAGS).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <div className="build-summary-price">
        <span className="build-summary-price-label">预计总价</span>
        {midpoint !== null ? (
          <>
            <strong>{formatYuanParts(midpoint)}</strong>
            <span className="build-summary-price-range">
              区间 {formatYuanParts(low!)} – {formatYuanParts(high!)}
            </span>
          </>
        ) : (
          <strong className="build-summary-price-unknown">待证据</strong>
        )}
        <small>{priceBasisNote(proposal)}</small>
      </div>
    </section>
  );
}
