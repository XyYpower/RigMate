import { describe, expect, it } from "vitest";
import { externalHintQueuePayload } from "@/ui/session/advice-queue";
import type { ExperienceAdviceItem } from "@/contracts/design";

// M4 Task 2（blueprint §7.3）：库外产品提示的唯一动作是写待审核队列（new_product）——
// 不自动建产品、不进正式方案。payload 组装是纯函数。

const externalHint: ExperienceAdviceItem = {
  kind: "external_product_hint",
  category: "case",
  title: "待验证产品",
  detail: "海景房机箱还有一款值得核验后收录",
  productName: "某品牌海景房机箱",
  requiresVerification: true,
};

describe("externalHintQueuePayload", () => {
  it("待验证产品 → new_product 队列 payload（带方案来源标记）", () => {
    const payload = externalHintQueuePayload(externalHint, "proposal p-1 v2");
    expect(payload).toEqual({
      queueType: "new_product",
      category: "case",
      userInput: "某品牌海景房机箱",
      candidateCanonicalIds: [],
      missingFields: [],
      priority: "normal",
      reason: expect.stringContaining("值得核验后收录"),
    });
    expect(payload?.reason).toContain("方案会话模型建议");
    expect(payload?.reason).toContain("proposal p-1 v2");
  });

  it("经验建议没有队列动作（只有待验证产品可入队）", () => {
    const advice: ExperienceAdviceItem = {
      kind: "experience_advice",
      category: "gpu",
      title: "显存取舍",
      detail: "剪辑优先更大显存",
      requiresVerification: false,
    };
    expect(externalHintQueuePayload(advice)).toBeNull();
  });
});
