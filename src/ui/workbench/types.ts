import type { BuildItemCategory } from "@/domain/build/types";
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

/** 装配轨道单个槽位状态（2026-10-08 决策台 UI 重置） */
export type AssemblySlotState =
  | "empty"
  | "retrieving"
  | "ready"
  | "attention"
  | "conflict"
  | "unknown";

/** 装配轨道槽位：八类硬件各一格，缺失事实为 null */
export type AssemblySlot = {
  category: BuildItemCategory;
  label: string;
  model: string | null;
  state: AssemblySlotState;
  detail: string | null;
};

/** 预算标尺：预算线 + 估算区间 + 中值；无预算时 state=unknown 且 budgetCents=null */
export type BudgetRulerView = {
  budgetCents: number | null;
  lowCents: number | null;
  highCents: number | null;
  midpointCents: number | null;
  state: "unknown" | "within" | "crossing" | "over";
};

/** 核验台条目：按 conflict → attention → unknown → pass 排序呈现 */
export type VerificationDeskItem = {
  id: string;
  state: "conflict" | "attention" | "unknown" | "pass";
  title: string;
  impact: string;
  evidenceLabel: string | null;
  actionLabel: string | null;
};

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
