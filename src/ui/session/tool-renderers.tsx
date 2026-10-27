import type { TimelineItem } from "./session-state";

/**
 * 工具块渲染注册表（agent-ui-design §5.2，P2）。
 *
 * 借鉴 ZCode ToolCallBlocks：每类工具一个元数据条目（标签 + 状态行），
 * 统一外观由 ToolBlock 组件渲染（状态点 + 标签 + 摘要 + 可折叠命中明细）。
 */

export type ToolMeta = {
  label: string;
  /** 命中明细行的说明前缀；缺省用 "命中明细" */
  detailLabel?: string;
};

const TOOL_META: Record<string, ToolMeta> = {
  searchCatalog: { label: "检索目录", detailLabel: "命中型号" },
  searchEvidence: { label: "证据链核对", detailLabel: "证据来源" },
  runCompatibilityCheck: { label: "兼容性检查", detailLabel: "涉及规则" },
  parse_intent: { label: "AI 理解目标", detailLabel: "涉及型号" },
  select_catalog_candidates: { label: "AI 挑选型号", detailLabel: "选中型号" },
  propose_swap: { label: "AI 更换型号", detailLabel: "候选" },
  revise_intent: { label: "AI 理解修改" },
};

const FALLBACK_META: ToolMeta = { label: "工具调用", detailLabel: "命中" };

export function toolMetaOf(tool: string): ToolMeta {
  return TOOL_META[tool] ?? FALLBACK_META;
}

/** 工具块的摘要行：detail 已是面向用户的一句话（service 生成时保证） */
export function toolSummaryOf(item: Extract<TimelineItem, { kind: "tool" }>): string {
  return item.detail || toolMetaOf(item.tool).label;
}
