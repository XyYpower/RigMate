"use client";

import type { Finding } from "@/domain/build/types";
import { toFindingCardModel } from "@/ui/finding-model";
import { EvidenceStamp } from "@/ui/components/evidence-stamp";

type FindingCardProps = {
  finding: Finding;
  /** 画布联动预留：目录阶段画布复活后，点击条款聚焦涉事部件（设计文档 §5.3） */
  onFocusItems?: (itemIds: string[]) => void;
};

/**
 * 诊断条款（业务规格 §12.3 六要素）：结论 / 证据 / 数据日期 / 置信度 / 假设条件 / 建议动作。
 * 版式 v3：报告式条款——左侧状态词（页边批注），右侧正文，无卡片边框，靠发丝线分隔。
 */
export function FindingCard({ finding, onFocusItems }: FindingCardProps) {
  const model = toFindingCardModel(finding);
  return (
    <article
      className="finding"
      onClick={onFocusItems ? () => onFocusItems(finding.itemIds) : undefined}
    >
      <div className={`finding-status ${finding.status}`}>{model.statusLabel}</div>
      <div className="finding-body">
        <div className="finding-top">
          <strong className="finding-conclusion">{model.conclusion}</strong>
          <code className="rule">{model.ruleId}</code>
        </div>

        <div className="finding-meta">
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
