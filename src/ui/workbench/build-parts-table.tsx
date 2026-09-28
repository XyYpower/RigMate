import type { ProposalItem } from "@/contracts/design";
import { productPageUrl } from "@/ui/product-link";
import { formatYuanRange } from "./format";

const CATEGORY_LABELS: Record<string, string> = {
  cpu: "处理器",
  motherboard: "主板",
  gpu: "显卡",
  ram: "内存",
  storage: "存储",
  psu: "电源",
  cooler: "散热器",
  case: "机箱",
};

/**
 * 配置清单表（参考图：部件 | 型号 | 数量 | 参考价格 | 详情）。
 * 数量固定 1（方案粒度）；价格区间为经验估算；依据折叠呈现真实来源。
 */
export function BuildPartsTable({ items }: { items: ProposalItem[] }) {
  return (
    <div className="build-parts" role="table" aria-label="配置清单">
      <div className="build-parts-head" role="row">
        <span>部件</span>
        <span>型号</span>
        <span className="num">数量</span>
        <span className="num">参考价格</span>
        <span aria-hidden />
      </div>
      {items.map((item) => (
        <details className="build-parts-row" key={`${item.category}-${item.catalogId ?? item.label}`}>
          <summary role="row">
            <span className="build-parts-cat">{CATEGORY_LABELS[item.category] ?? item.category}</span>
            <span className="build-parts-model">
              {item.label}
              {item.confirmationRequired && <em className="build-parts-confirm">待确认</em>}
            </span>
            <span className="num">1</span>
            <span className="num build-parts-price">{formatYuanRange(item.priceEstimateLowCents, item.priceEstimateHighCents)}</span>
            <span className="build-parts-arrow" aria-hidden>›</span>
          </summary>
          <div className="build-parts-detail">
            <p>{item.rationale}</p>
            <p>
              来源：{item.sourceLevel === "verified_catalog" ? "已核目录型号" : item.sourceLevel}
              {item.catalogId && <> · 型号 ID <code>{item.catalogId}</code></>}
              {" · "}价格口径：{item.priceBasis === "experience_estimate" ? "经验估算" : item.priceBasis}
            </p>
            {item.confirmationRequired && item.confirmationReason && (
              <p className="build-parts-confirm-reason">需要确认：{item.confirmationReason}</p>
            )}
            <p>
              <a href={productPageUrl(item.label)} target="_blank" rel="noreferrer">
                查看商品页 ↗
              </a>
            </p>
          </div>
        </details>
      ))}
    </div>
  );
}
