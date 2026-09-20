import type { FindingStatus } from "@/domain/build/types";
import { STATUS_META } from "@/ui/finding-model";

type StatusChipProps = {
  status: FindingStatus;
  /** 计数模式：文本为「标签 N」（e2e 依赖精确文本，如「阻断 1」） */
  count?: number;
  /** 独立使用时显示状态符号；计数模式默认关闭以保证文本精确 */
  showIcon?: boolean;
  className?: string;
};

/** 结论状态章：诊断摘要计数行、清单状态点共用（颜色来自全站语义色系） */
export function StatusChip({ status, count, showIcon = false, className }: StatusChipProps) {
  const visual = STATUS_META[status];
  return (
    <span
      className={`status-chip ${className ?? ""}`}
      style={{ background: visual.soft, color: visual.color }}
    >
      {showIcon && <span aria-hidden>{visual.icon}</span>}
      {visual.label}
      {typeof count === "number" ? ` ${count}` : ""}
    </span>
  );
}
