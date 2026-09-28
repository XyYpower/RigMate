import type { ReactNode } from "react";
import type { WorkspaceStatus } from "./types";

const STATUS_LABEL: Record<WorkspaceStatus, string> = {
  loading: "进行中",
  ready: "就绪",
  attention: "待确认",
  conflict: "存在冲突",
  unknown: "待补充",
  accepted: "已接受",
  error: "出错",
};

/** 状态徽章（DESIGN.md §6 StatusBadge）：色点 + 状态词 */
export function StatusBadge({ status }: { status: WorkspaceStatus }) {
  return (
    <span className={`wb-status-badge wb-status-${status}`}>
      <i aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * 顶部工作栏（DESIGN.md §4）：标题 + 状态徽章 | 中部插槽（修订输入）| 右侧主动作。
 * 同屏唯一橙色主按钮由调用方保证。
 */
export function WorkspaceHeader({
  title,
  meta,
  status,
  center,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  status?: WorkspaceStatus;
  center?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="workbench-header">
      <div className="workbench-header-title">
        <h1>{title}</h1>
        {meta && <p>{meta}</p>}
        {status && <StatusBadge status={status} />}
      </div>
      {center && <div className="workbench-header-center">{center}</div>}
      {actions && <div className="workbench-header-actions">{actions}</div>}
    </header>
  );
}
