import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// 混合建议层（hybrid-llm-advice 计划 Task 1）：
// experienceAdvice 契约——经验建议与数据库外产品提示分离，拒绝价格/规格等未验证事实字段；
// 持久化——design_proposals.experience_advice 独立列，旧方案行缺省空数组。
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-design-advice-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "advice.db");

const contracts = await import("@/contracts/design");
const repo = await import("@/infra/db/repositories/design-repository");
const { closeDatabase } = await import("@/infra/db/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

function baseProposalItem() {
  return {
    category: "cpu" as const,
    label: "AMD Ryzen 7 9800X3D",
    spec: {},
    sourceLevel: "supported_catalog" as const,
    priceEstimateLowCents: null,
    priceEstimateHighCents: null,
    priceBasis: "unknown" as const,
    rationale: "测试用占位",
    confirmationRequired: false,
  };
}

function baseProposal() {
  return {
    id: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    version: 1,
    status: "ready" as const,
    title: "测试方案",
    summary: "八类齐全的测试方案",
    budgetCents: 2_000_000,
    estimatedLowCents: 1_500_000,
    estimatedHighCents: 1_900_000,
    items: [baseProposalItem()],
    fitNotes: [],
    tradeoffs: [],
    unknowns: [],
    compatibility: {
      status: "ok" as const,
      message: "全部通过",
      blockCount: 0,
      warnCount: 0,
      unknownCount: 0,
      passCount: 1,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("experienceAdvice 契约（严格 schema）", () => {
  it("经验建议：不带产品名、无需验证，合法", () => {
    const parsed = contracts.experienceAdviceItemSchema.parse({
      kind: "experience_advice",
      category: "gpu",
      title: "显存取舍",
      detail: "这个预算段剪辑用途通常更看重显存余量",
      requiresVerification: false,
    });
    expect(parsed.kind).toBe("experience_advice");
  });

  it("数据库外产品提示：必须带产品名且 requiresVerification=true", () => {
    const parsed = contracts.experienceAdviceItemSchema.parse({
      kind: "external_product_hint",
      category: "gpu",
      title: "待验证产品",
      detail: "同档位还有一款型号值得核验后收录",
      productName: "某品牌某型号显卡",
      requiresVerification: true,
    });
    expect(parsed.requiresVerification).toBe(true);
  });

  it("数据库外产品提示缺产品名 → 拒绝", () => {
    expect(() =>
      contracts.experienceAdviceItemSchema.parse({
        kind: "external_product_hint",
        category: "gpu",
        title: "建议型号",
        detail: "RTX 5090 24GB，约 ¥19999",
        requiresVerification: true,
      }),
    ).toThrow();
  });

  it("数据库外产品提示未标记待验证 → 拒绝（库外线索只能以待验证状态存在）", () => {
    expect(() =>
      contracts.experienceAdviceItemSchema.parse({
        kind: "external_product_hint",
        category: "gpu",
        title: "建议型号",
        detail: "值得核验",
        productName: "某品牌某型号显卡",
        requiresVerification: false,
      }),
    ).toThrow();
  });

  it("经验建议携带产品名 → 拒绝（产品名只能走待验证通道）", () => {
    expect(() =>
      contracts.experienceAdviceItemSchema.parse({
        kind: "experience_advice",
        category: "gpu",
        title: "显存取舍",
        detail: "建议考虑更大显存",
        productName: "RTX 5060",
        requiresVerification: false,
      }),
    ).toThrow();
  });

  it("建议携带价格等未验证事实字段 → strict schema 拒绝", () => {
    expect(() =>
      contracts.experienceAdviceItemSchema.parse({
        kind: "experience_advice",
        category: "gpu",
        title: "显存取舍",
        detail: "建议考虑更大显存",
        requiresVerification: false,
        priceCents: 199_990,
      }),
    ).toThrow();
  });
});

describe("experienceAdvice 持久化", () => {
  it("方案携带建议落库后回读一致；schema 解析旧形态对象缺省空数组", () => {
    const proposal = contracts.designProposalSchema.parse({
      ...baseProposal(),
      experienceAdvice: [
        {
          kind: "experience_advice",
          category: "gpu",
          title: "显存取舍",
          detail: "剪辑用途优先更大显存",
          requiresVerification: false,
        },
        {
          kind: "external_product_hint",
          category: "case",
          title: "待验证产品",
          detail: "海景房机箱可核验后收录",
          productName: "某品牌海景房机箱",
          requiresVerification: true,
        },
      ],
    });
    expect(proposal.experienceAdvice).toHaveLength(2);

    repo.saveDesignRequest({
      id: proposal.requestId,
      rawInput: "2 万预算剪辑和游戏",
      intent: {
        budgetCents: 2_000_000,
        useCases: ["剪辑"],
        appearance: [],
        existingParts: [],
        constraints: [],
        region: "中国大陆",
      },
      status: "ready_to_review",
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
    });
    repo.saveDesignProposal(proposal);

    const loaded = repo.findProposal(proposal.id);
    expect(loaded).toBeDefined();
    expect(loaded?.experienceAdvice).toEqual(proposal.experienceAdvice);

    // 旧形态（无 advice 字段）：读取路径缺省空数组，不破坏历史方案
    const legacy = contracts.designProposalSchema.parse(baseProposal());
    expect(legacy.experienceAdvice).toEqual([]);
  });

});
