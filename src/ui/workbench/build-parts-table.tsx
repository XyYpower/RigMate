import type { ProposalItem, SourceLevel } from "@/contracts/design";
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

/** 核验列与详情里的真实来源文案：unknown / 待确认不得显示为已核 */
const SOURCE_LABEL: Record<SourceLevel, string> = {
  verified_catalog: "已核目录",
  price_evidence: "证据价格",
  user_input: "你的输入",
  model_experience: "经验推断",
  unknown: "资料不足",
};

function sourceSeverity(sourceLevel: SourceLevel): "pass" | "warn" | "unknown" {
  if (sourceLevel === "verified_catalog" || sourceLevel === "price_evidence") return "pass";
  if (sourceLevel === "unknown") return "unknown";
  return "warn";
}

/** 来源完整句（详情区）：不再把所有行统一写成"已核目录型号" */
function sourceSentence(sourceLevel: SourceLevel): string {
  switch (sourceLevel) {
    case "verified_catalog":
      return "已核目录型号（规格经证据链核验）";
    case "price_evidence":
      return "价格证据绑定的目录型号";
    case "user_input":
      return "你的输入，未经目录核验";
    case "model_experience":
      return "经验推断型号，未经目录核验";
    default:
      return "资料不足，待补充";
  }
}

/**
 * 配置清单表（DESIGN.md §6 BuildPartsTable）：
 * 列：部件 | 型号 | 核验 | 数量 | 参考价格 | 详情。数量列桌面保留，窄屏并入型号行内。
 * 每行显示真实 sourceLevel 文案；待确认与资料不足可读。
 */
export function BuildPartsTable({ items }: { items: ProposalItem[] }) {
  return (
    <div className="build-parts" role="table" aria-label="配置清单">
      <div className="build-parts-head" role="row">
        <span>部件</span>
        <span>型号</span>
        <span>核验</span>
        <span className="num build-parts-qty-col">数量</span>
        <span className="num">参考价格</span>
        <span aria-hidden />
      </div>
      {items.map((item) => {
        const sourceLabel = SOURCE_LABEL[item.sourceLevel];
        return (
          <details
            className="build-parts-row"
            key={`${item.category}-${item.catalogId ?? item.label}`}
            data-category={item.category}
          >
            <summary role="row">
              <span className="build-parts-cat">{CATEGORY_LABELS[item.category] ?? item.category}</span>
              <span className="build-parts-model">
                <span className="build-parts-model-name">
                  {item.label}
                  {item.confirmationRequired && <em className="build-parts-confirm">待确认</em>}
                </span>
                <span className="build-parts-model-meta">
                  数量 1 · {sourceLabel}
                </span>
              </span>
              <span className={`build-parts-verify verify-${item.confirmationRequired ? "warn" : sourceSeverity(item.sourceLevel)}`}>
                {item.confirmationRequired ? "待确认" : sourceLabel}
              </span>
              <span className="num build-parts-qty-col">1</span>
              <span className="num build-parts-price">{formatYuanRange(item.priceEstimateLowCents, item.priceEstimateHighCents)}</span>
              <span className="build-parts-arrow" aria-hidden>›</span>
            </summary>
            <div className="build-parts-detail">
              <p>{item.rationale}</p>
              <p>
                来源：{sourceSentence(item.sourceLevel)}
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
        );
      })}
    </div>
  );
}
