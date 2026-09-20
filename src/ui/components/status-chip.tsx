import type { FindingStatus } from "@/domain/build/types";
import { STATUS_META } from "@/ui/finding-model";

type StatusChipProps = {
  status: FindingStatus;
  count?: number;
  className?: string;
};

/** 结论状态章：诊断摘要计数行、清单状态点共用（颜色来自全站语义色系） */
export function StatusChip({ status, count, className }: StatusChipProps) {
  const visual = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold ${className ?? ""}`}
      style={{ background: visual.soft, color: visual.color }}
    >
      <span aria-hidden>{visual.icon}</span>
      {visual.label}
      {typeof count === "number" && <span className="tabular-nums">{count}</span>}
    </span>
  );
}
