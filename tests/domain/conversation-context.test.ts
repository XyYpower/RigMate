import { describe, expect, it } from "vitest";
import {
  buildConversationContext,
  conversationContextSchema,
  type ConversationContextInput,
} from "@/domain/design/conversation-context";
import type { DesignProposal } from "@/contracts/design";

// M1 任务和会话契约（launch-readiness Phase 2）：服务端维护结构化会话状态，
// 模型只收到结构化摘要 + 最近两轮用户消息，完整事件历史留在审计日志。

function proposalOf(overrides: Partial<DesignProposal> = {}): DesignProposal {
  return {
    id: "00000000-0000-4000-8000-00000000aa01",
    requestId: "00000000-0000-4000-8000-00000000bb01",
    version: 2,
    status: "ready",
    title: "白色剪辑机",
    summary: "按预算与用途搭配",
    budgetCents: 1_500_000,
    estimatedLowCents: 1_200_000,
    estimatedHighCents: 1_450_000,
    items: [
      {
        category: "cpu",
        label: "AMD Ryzen 7 9800X3D",
        catalogId: "cpu-9800x3d",
        spec: {},
        sourceLevel: "supported_catalog",
        qualityStatus: "supported" as const,
        fieldQuality: {},
        evidenceSourceIds: [],
        priceEstimateLowCents: null,
        priceEstimateHighCents: null,
        priceBasis: "unknown",
        rationale: "测试",
        confirmationRequired: false,
      },
      {
        category: "gpu",
        label: "RTX 4070 SUPER",
        catalogId: "gpu-4070s",
        spec: {},
        sourceLevel: "supported_catalog",
        qualityStatus: "supported" as const,
        fieldQuality: {},
        evidenceSourceIds: [],
        priceEstimateLowCents: null,
        priceEstimateHighCents: null,
        priceBasis: "unknown",
        rationale: "测试",
        confirmationRequired: false,
      },
    ],
    fitNotes: [],
    tradeoffs: ["预算内优先静音", "显卡让位 CPU"],
    unknowns: ["机箱显卡限长未知", "主板 M.2 数量未知"],
    experienceAdvice: [],
    compatibility: {
      status: "attention",
      message: "有 2 项待留意",
      blockCount: 0,
      warnCount: 1,
      unknownCount: 1,
      passCount: 10,
    },
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...overrides,
  };
}

function baseInput(overrides: Partial<ConversationContextInput> = {}): ConversationContextInput {
  return {
    requestId: "00000000-0000-4000-8000-00000000cc01",
    turn: 3,
    intent: {
      budgetCents: 1_500_000,
      useCases: ["游戏", "视频剪辑"],
      appearance: ["白色"],
      existingParts: [],
      constraints: ["优先安静"],
      region: "中国大陆",
    },
    ...overrides,
  };
}

describe("ConversationContext 构建器（M1）", () => {
  it("从请求与最新方案构建：selectedIds 只收非空 catalogId，取舍与发现结构化", () => {
    const context = buildConversationContext(baseInput({ latestProposal: proposalOf() }));
    expect(context.turn).toBe(3);
    expect(context.intent.budgetCents).toBe(1_500_000);
    expect(context.latestProposal).toEqual({
      id: "00000000-0000-4000-8000-00000000aa01",
      version: 2,
      selectedIds: ["cpu-9800x3d", "gpu-4070s"],
    });
    expect(context.latestTradeoffs).toEqual(["预算内优先静音", "显卡让位 CPU"]);
    // 发现 = 兼容摘要一条 + 每条 unknown 一条（ruleId 可定位、状态如实）
    expect(context.latestFindings).toContainEqual({
      ruleId: "compatibility",
      status: "attention",
      conclusion: "有 2 项待留意",
    });
    expect(context.latestFindings).toContainEqual({
      ruleId: "missing_field",
      status: "unknown",
      conclusion: "机箱显卡限长未知",
    });
  });

  it("最近用户消息最多保留两条（短期语境，完整历史在事件日志）", () => {
    const context = buildConversationContext(
      baseInput({ userMessages: ["预算 1.5 万", "机箱要白色海景房", "我已有电源"] }),
    );
    expect(context.recentUserMessages).toEqual(["机箱要白色海景房", "我已有电源"]);
  });

  it("无方案/无追问时字段为 null，confirmedFields 缺省空数组", () => {
    const context = buildConversationContext(baseInput());
    expect(context.latestProposal).toBeNull();
    expect(context.pendingQuestion).toBeNull();
    expect(context.confirmedFields).toEqual([]);
    expect(context.latestTradeoffs).toEqual([]);
    expect(context.latestFindings).toEqual([]);
  });

  it("pendingQuestion 原样保留（追问轮次的上下文）", () => {
    const context = buildConversationContext(
      baseInput({ pendingQuestion: "预算是否包含显示器？" }),
    );
    expect(context.pendingQuestion).toBe("预算是否包含显示器？");
  });

  it("strict schema：上下文之外的键被拒绝（越权字段防扩散）", () => {
    expect(() =>
      conversationContextSchema.parse({
        ...buildConversationContext(baseInput()),
        sql: "select 1",
      }),
    ).toThrow();
  });
});
