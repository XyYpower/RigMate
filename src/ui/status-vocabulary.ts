/**
 * 全站统一状态词汇表（DESIGN.md v3 自解释原则 3）：
 * 同一实体只有一套词，任何页面不得自造同义词（此前 /design 用「待确认」、
 * /projects 草稿区用「待补充目标/已生成正式方案」两套词汇，是 IA 断裂点）。
 */

/** 方案会话（design request）状态 */
export const SESSION_STATUS_LABELS: Record<string, string> = {
  generating: "生成中",
  needs_input: "待补充",
  ready_to_review: "待确认",
  accepted: "已接受",
};

export function sessionStatusLabel(status: string, acceptedBuildId: string | null): string {
  return acceptedBuildId ? "已接受" : SESSION_STATUS_LABELS[status] ?? status;
}
