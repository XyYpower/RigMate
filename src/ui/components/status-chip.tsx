import type { FindingStatus } from "@/domain/build/types";
import { STATUS_META } from "@/ui/finding-model";

type StatusChipProps = {
  status: FindingStatus;
  /** 计数模式：文本为「标签 N」（e2e 依赖精确文本，如「阻断 1」） */
  count?: number;
  /** 显示状态符号而非色点 */
  showIcon?: boolean;
  className?: string;
};

/** 结论状态章：诊断摘要计数行使用（色点 + 标签 + 计数，仪器台风格） */
export function StatusChip({ status, count, showIcon = false, className }: StatusChipProps) {
  const visual = STATUS_META[status];
  return (
    <span className={`status-chip ${className ?? ""}`} style={{ color: visual.color }}>
      {showIcon ? (
        <span aria-hidden>{visual.icon}</span>
      ) : (
        <span className="tally-mark" aria-hidden style={{ background: visual.color }} />
      )}
      {visual.label}
      {typeof count === "number" ? ` ${count}` : ""}
    </span>
  );
}
