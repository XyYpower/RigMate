type EvidenceStampProps = {
  /** 证据来源（规则编号 / 数据来源）；省略时只显示日期与等级 */
  source?: string | null;
  date?: string | null;
  level?: string | null;
  className?: string;
};

/**
 * 证据小字（来源 · 日期 · 等级）——设计文档 §8.3：
 * 每个结论/数字旁永远跟着可追溯信息，鼓励用户点开证据而不是只看结论。
 */
export function EvidenceStamp({ source, date, level, className }: EvidenceStampProps) {
  const parts = [source, date, level].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  if (parts.length === 0) return null;
  return <span className={`stamp ${className ?? ""}`}>{parts.join(" · ")}</span>;
}
