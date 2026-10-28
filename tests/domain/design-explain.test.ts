import { describe, expect, it } from "vitest";
import { answerDraftSchema } from "@/contracts/design";
import { buildExplainAnswer, renderAnswerDraft } from "@/domain/design/explain";
import type { DesignProposal } from "@/contracts/design";

// M4 Task 1（blueprint §7.4）：回答层契约 AnswerDraft——回答只引用方案里已存在的事实
// （rationale/质量状态/价格口径/兼容结论），中文文案由渲染器生成，模型零参与。

function proposalOf(): DesignProposal {
  return {
    id: "00000000-0000-4000-8000-00000000dd01",
    requestId: "00000000-0000-4000-8000-00000000dd02",
    version: 2,
    status: "ready",
    title: "白色剪辑机",
    summary: "按预算与用途搭配",
    budgetCents: 1_500_000,
    estimatedLowCents: 1_200_000,
    estimatedHighCents: 1_450_000,
    items: [
      {
        category: "gpu",
        label: "RTX 4070 SUPER",
        catalogId: "gpu-4070s",
        spec: {},
        sourceLevel: "supported_catalog",
        qualityStatus: "supported",
        fieldQuality: {},
        evidenceSourceIds: [],
        priceEstimateLowCents: 429_900,
        priceEstimateHighCents: 459_900,
        priceBasis: "experience_estimate",
        rationale: "2K 分辨率下兼顾剪辑导出与 3A 游戏，显存 12G 够用",
        confirmationRequired: false,
      },
      {
        category: "psu",
        label: "海韵 FOCUS GX-850",
        catalogId: "psu-gx850",
        spec: {},
        sourceLevel: "verified_catalog",
        qualityStatus: "verified",
        fieldQuality: {},
        evidenceSourceIds: ["src-1"],
        priceEstimateLowCents: null,
        priceEstimateHighCents: null,
        priceBasis: "unknown",
        rationale: "850W 为高负载留出余量",
        confirmationRequired: false,
      },
    ],
    fitNotes: [],
    tradeoffs: ["预算内优先静音"],
    unknowns: ["机箱显卡限长未知"],
    experienceAdvice: [
      {
        kind: "experience_advice",
        category: "gpu",
        title: "显存取舍",
        detail: "剪辑素材大时优先更大显存",
        requiresVerification: false,
      },
    ],
    referencePrices: [],
    compatibility: {
      status: "ok",
      message: "兼容性检查全部通过",
      blockCount: 0,
      warnCount: 0,
      unknownCount: 0,
      passCount: 12,
    },
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  };
}

describe("buildExplainAnswer（问依据的确定性回答）", () => {
  it("问句点名类别 → 回答含该件理由、价格口径与质量状态", () => {
    const draft = buildExplainAnswer({ instruction: "为什么选这个显卡？", proposal: proposalOf() });
    expect(draft).not.toBeNull();
    expect(draft?.summary).toContain("RTX 4070 SUPER");
    expect(draft?.summary).toContain("2K 分辨率下兼顾剪辑导出与 3A 游戏");
    expect(draft?.summary).toContain("经验估算");
    expect(draft?.summary).toContain("有参考资料目录");
    // 本轮无持久化 claims：claimIds 诚实为空
    expect(draft?.claimIds).toEqual([]);
    // 方案带建议时回答引用建议项
    expect(draft?.adviceIds).toEqual([0]);
  });

  it("问全部搭配 → 概览式回答逐件列理由", () => {
    const draft = buildExplainAnswer({ instruction: "为什么这么搭配？", proposal: proposalOf() });
    expect(draft?.summary).toContain("RTX 4070 SUPER");
    expect(draft?.summary).toContain("海韵 FOCUS GX-850");
    expect(draft?.summary).toContain("兼容性检查全部通过");
  });

  it("问句没提到方案内的类别 → null（回落 M3 指引）", () => {
    expect(buildExplainAnswer({ instruction: "为什么选这个声卡？", proposal: proposalOf() })).toBeNull();
  });

  it("strict 契约：AnswerDraft 之外的键被拒绝", () => {
    const draft = buildExplainAnswer({ instruction: "为什么这么搭配？", proposal: proposalOf() })!;
    expect(() => answerDraftSchema.parse({ ...draft, sql: "select 1" })).toThrow();
  });
});

describe("renderAnswerDraft（中文渲染）", () => {
  it("渲染 summary + actions，不新增事实", () => {
    const draft = buildExplainAnswer({ instruction: "为什么选这个显卡？", proposal: proposalOf() })!;
    const text = renderAnswerDraft(draft);
    expect(text).toContain("RTX 4070 SUPER");
    expect(text).toContain("可以这样调整");
    // 渲染器只输出 draft 内容
    expect(text.length).toBeGreaterThan(draft.summary.length);
  });
});
