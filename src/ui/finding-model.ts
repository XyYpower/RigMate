import type { Finding, FindingStatus } from "@/domain/build/types";

/**
 * 结论状态的语义视觉映射（设计文档 §8.2）。
 * 全站唯一语义色系：装机台画布、诊断卡、行情新鲜度全部复用这一份。
 */
export type StatusVisual = {
  label: string;
  icon: string;
  color: string;
  soft: string;
  /** unknown 使用虚线："缺数据不猜默认值"的视觉身份（虚线幽灵） */
  borderStyle: "solid" | "dashed";
};

export const STATUS_META: Record<FindingStatus, StatusVisual> = {
  pass: { label: "通过", icon: "✓", color: "var(--rm-pass)", soft: "var(--rm-pass-soft)", borderStyle: "solid" },
  block: { label: "阻断", icon: "!", color: "var(--rm-block)", soft: "var(--rm-block-soft)", borderStyle: "solid" },
  warn: { label: "警告", icon: "⚠", color: "var(--rm-warn)", soft: "var(--rm-warn-soft)", borderStyle: "solid" },
  unknown: { label: "待补充", icon: "?", color: "var(--rm-unknown)", soft: "var(--rm-unknown-soft)", borderStyle: "dashed" },
  not_applicable: { label: "不适用", icon: "–", color: "var(--rm-na)", soft: "var(--rm-na-soft)", borderStyle: "solid" },
};

/** 报告排序（业务规格 §9.4）：阻断 → 待补充 → 警告 → 通过 → 不适用 */
export const STATUS_ORDER: readonly FindingStatus[] = [
  "block",
  "unknown",
  "warn",
  "pass",
  "not_applicable",
];

export const CONFIDENCE_LABEL: Record<Finding["confidence"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

/**
 * 诊断卡视图模型：业务规格 §12.3 六要素
 * （结论 / 证据 / 数据日期 / 置信度 / 假设条件 / 建议动作）。
 * 领域 Finding 已带全部字段；早期 page.tsx 本地类型丢失了后四项，此模型负责完整呈现。
 */
export type FindingCardModel = {
  ruleId: string;
  status: FindingStatus;
  statusLabel: string;
  statusIcon: string;
  accentColor: string;
  softColor: string;
  accentBorderStyle: "solid" | "dashed";
  conclusion: string;
  evidenceLines: string[];
  dataDate: string | null;
  confidenceLabel: string;
  assumptions: string[];
  missingFields: string[];
  suggestedAction: string;
};

export function toFindingCardModel(finding: Finding): FindingCardModel {
  const visual = STATUS_META[finding.status];
  return {
    ruleId: finding.ruleId,
    status: finding.status,
    statusLabel: visual.label,
    statusIcon: visual.icon,
    accentColor: visual.color,
    softColor: visual.soft,
    accentBorderStyle: visual.borderStyle,
    conclusion: finding.conclusion,
    evidenceLines: finding.evidence,
    dataDate: finding.dataDate,
    confidenceLabel: CONFIDENCE_LABEL[finding.confidence],
    assumptions: finding.assumptions,
    missingFields: finding.missingFields,
    suggestedAction: finding.suggestedAction,
  };
}
