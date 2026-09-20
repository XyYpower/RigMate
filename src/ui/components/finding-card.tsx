"use client";

import type { Finding } from "@/domain/build/types";
import { toFindingCardModel } from "@/ui/finding-model";
import { EvidenceStamp } from "@/ui/components/evidence-stamp";

type FindingCardProps = {
  finding: Finding;
  /** 画布联动预留：三栏改造接线后，点击卡片聚焦涉事部件（设计文档 §5.3） */
  onFocusItems?: (itemIds: string[]) => void;
};

/**
 * 六要素诊断卡（业务规格 §12.3）：结论 / 证据 / 数据日期 / 置信度 / 假设条件 / 建议动作。
 * 相比现有 page.tsx 内联渲染，补齐了数据日期、置信度与假设条件三要素的展示。
 */
export function FindingCard({ finding, onFocusItems }: FindingCardProps) {
  const model = toFindingCardModel(finding);
  return (
    <article
      className="flex gap-4 border p-5"
      style={{
        borderLeft: `3px ${model.accentBorderStyle} ${model.accentColor}`,
        background: model.softColor,
        borderColor: "var(--rm-line)",
      }}
      onClick={onFocusItems ? () => onFocusItems(finding.itemIds) : undefined}
    >
      <div className="flex w-14 flex-none flex-col items-center gap-1.5">
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold"
          style={{ background: model.accentColor, color: "var(--rm-bg)" }}
        >
          {model.statusIcon}
        </span>
        <small className="text-[10px] font-bold" style={{ color: model.accentColor }}>
          {model.statusLabel}
        </small>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <strong className="text-sm leading-relaxed" style={{ color: "var(--rm-ink)" }}>
            {model.conclusion}
          </strong>
        </div>

        <EvidenceStamp
          className="mt-2"
          source={model.ruleId}
          date={model.dataDate ? `数据日期 ${model.dataDate}` : "数据日期未记录"}
          level={`置信度 ${model.confidenceLabel}`}
        />

        {model.evidenceLines.length > 0 && (
          <ul className="mt-2 grid gap-1 text-[11px]" style={{ color: "var(--rm-ink-muted)" }}>
            {model.evidenceLines.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        )}

        {model.missingFields.length > 0 && (
          <p className="mt-3 text-[11px] font-bold" style={{ color: model.accentColor }}>
            待补充：{model.missingFields.join("、")}
          </p>
        )}

        {model.assumptions.length > 0 && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--rm-ink-faint)" }}>
            假设条件：{model.assumptions.join("；")}
          </p>
        )}

        <p className="mt-3 text-[11px] font-bold" style={{ color: "var(--rm-accent)" }}>
          下一步：{model.suggestedAction}
        </p>
      </div>
    </article>
  );
}
