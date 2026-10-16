import type { BuildItemCategory } from "@/domain/build/types";
import type { ExperienceAdviceItem } from "@/contracts/design";

/**
 * 库外产品提示 → 待审核队列（M4，blueprint §7.3）：
 * 唯一动作是写 pending_catalog_queue 的 new_product 项——不自动创建 canonical product，
 * 不进入正式方案。payload 组装是纯函数（可测），组件只负责提交与反馈。
 */

export type ExternalHintQueuePayload = {
  queueType: "new_product";
  category: BuildItemCategory;
  userInput: string;
  candidateCanonicalIds: string[];
  missingFields: string[];
  priority: "normal";
  reason: string;
};

export function externalHintQueuePayload(
  advice: ExperienceAdviceItem,
  sourceNote = "",
): ExternalHintQueuePayload | null {
  if (advice.kind !== "external_product_hint" || !advice.productName) return null;
  const source = sourceNote ? `（来源：方案会话模型建议 · ${sourceNote}）` : "（来源：方案会话模型建议）";
  return {
    queueType: "new_product",
    category: advice.category,
    userInput: advice.productName,
    candidateCanonicalIds: [],
    missingFields: [],
    priority: "normal",
    reason: `${advice.detail.slice(0, 200)}${source}`.slice(0, 300),
  };
}
