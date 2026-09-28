import type { DesignProposal } from "@/contracts/design";

/**
 * 三栏工作台共享类型（DESIGN.md §6，2026-09-28 基线）。
 * 展示组件只消费这些类型与回调；API 调用留在页面层。
 * 缺失事实一律 null / unknown，组件不猜。
 */

/** 全局状态集（DESIGN.md §7）：页面级与卡片级共用 */
export type WorkspaceStatus =
  | "loading"
  | "ready"
  | "attention"
  | "conflict"
  | "unknown"
  | "accepted"
  | "error";

/** 右栏 Agent 处理进度条目（由 AgentEvent 映射） */
export type AgentTimelineStep = {
  id: string;
  title: string;
  description: string;
  /** ISO 时间戳；进行中的步骤可为 null */
  at: string | null;
  state: "done" | "active" | "waiting";
};

/** 右栏"你的需求"摘要条目 */
export type RequirementSummary = {
  label: string;
  value: string;
};

/** 诊断条目（由 Finding / compatibilitySummary 映射） */
export type DiagnosticItem = {
  id: string;
  status: "conflict" | "attention" | "pass" | "unknown";
  title: string;
  basis: string[];
  suggestion?: string;
};

/** 顶栏主动作 + 决策条动作（展示组件只发回调） */
export type WorkspaceAction = {
  label: string;
  kind: "primary" | "secondary";
  disabled?: boolean;
  onAction: () => void;
};

/** 由 compatibilitySummary.status 映射为全局状态 */
export function workspaceStatusOf(proposal: DesignProposal): WorkspaceStatus {
  switch (proposal.compatibility.status) {
    case "conflict":
      return "conflict";
    case "attention":
      return "attention";
    case "unknown":
      return "unknown";
    default:
      return "ready";
  }
}
