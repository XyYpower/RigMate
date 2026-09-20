"use client";

import type { Finding } from "@/domain/build/types";
import { toFindingCardModel } from "@/ui/finding-model";
import { EvidenceStamp } from "@/ui/components/evidence-stamp";

type FindingCardProps = {
  finding: Finding;
  /** 画布联动预留：目录阶段画布复活后，点击卡片聚焦涉事部件（设计文档 §5.3） */
  onFocusItems?: (itemIds: string[]) => void;
};

/**
 * 六要素诊断卡（业务规格 §12.3）：结论 / 证据 / 数据日期 / 置信度 / 假设条件 / 建议动作。
 * 版式：左侧状态色条 + 结论行（右对齐规则编号）+ 证据与元信息，仪器台密度。
 */
export function FindingCard({ finding, onFocusItems }: FindingCardProps) {
  const model = toFindingCardModel(finding);
  return (
    <article
      className={`finding ${finding.status}`}
      onClick={onFocusItems ? () => onFocusItems(finding.itemIds) : undefined}
    >
      <div className="finding-accent" aria-hidden />
      <div className="finding-body">
        <div className="finding-top">
          <strong className="finding-conclusion">{model.conclusion}</strong>
          <code className="finding-rule">{model.ruleId}</code>
        </div>

        <div className="finding-meta">
          <span className="stamp" style={{ color: model.accentColor }}>{model.statusLabel}</span>
          <EvidenceStamp
            date={model.dataDate ? `数据日期 ${model.dataDate}` : "数据日期未记录"}
            level={`置信度 ${model.confidenceLabel}`}
          />
        </div>

        {model.evidenceLines.length > 0 && (
          <ul className="evidence">
            {model.evidenceLines.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        )}

        {model.missingFields.length > 0 && (
          <p className="finding-missing">待补充：{model.missingFields.join("、")}</p>
        )}

        {model.assumptions.length > 0 && (
          <p className="finding-assumption">假设条件：{model.assumptions.join("；")}</p>
        )}

        <p className="finding-action">下一步：{model.suggestedAction}</p>
      </div>
    </article>
  );
}
