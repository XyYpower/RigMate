import { describe, expect, it } from "vitest";
import { ClaimLedger, createClaim, validateClaim } from "@/domain/agent/claims";
import { validateProposalGrounding, downgradeUnverifiedPrices } from "@/application/agent/validator";
import type { AgentClaim, ClaimKind } from "@/contracts/agent";
import type { DesignProposal, ProposalItem } from "@/contracts/design";

function claimOf(kind: ClaimKind, overrides: Partial<AgentClaim> = {}): AgentClaim {
  return createClaim({
    kind,
    subject: overrides.subject ?? "cpu",
    statement: overrides.statement ?? "测试主张",
    sourceIds: overrides.sourceIds,
    attemptId: overrides.attemptId ?? null,
  });
}

function itemOf(overrides: Partial<ProposalItem> = {}): ProposalItem {
  return {
    category: "cpu",
    label: "AMD Ryzen 7 9800X3D",
    catalogId: "cpu-9800x3d",
    spec: {},
    sourceLevel: "supported_catalog",
    qualityStatus: "supported",
    fieldQuality: {},
    evidenceSourceIds: [],
    priceEstimateLowCents: 359_900,
    priceEstimateHighCents: 359_900,
    priceBasis: "evidence",
    rationale: "测试",
    confirmationRequired: false,
    ...overrides,
  };
}

function proposalOf(items: ProposalItem[]): DesignProposal {
  return {
    id: "00000000-0000-4000-8000-0000000000ab",
    requestId: "00000000-0000-4000-8000-0000000000cd",
    version: 1,
    status: "ready",
    title: "测试方案",
    summary: "测试",
    budgetCents: 2_000_000,
    estimatedLowCents: 359_900,
    estimatedHighCents: 359_900,
    items,
    fitNotes: [],
    tradeoffs: [],
    unknowns: [],
    compatibility: { status: "ok", message: "ok", blockCount: 0, warnCount: 0, unknownCount: 0, passCount: 1 },
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
}

describe("Claim Ledger（v2 Phase 5）", () => {
  it("七类主张全部可入账，按类别/主体可查", () => {
    const kinds: ClaimKind[] = [
      "catalog_fact",
      "price_fact",
      "rule_result",
      "user_fact",
      "experience_advice",
      "unknown",
      "question",
    ];
    const ledger = new ClaimLedger();
    for (const kind of kinds) {
      ledger.add(claimOf(kind));
    }
    expect(ledger.all()).toHaveLength(7);
    expect(ledger.byKind("catalog_fact")).toHaveLength(1);
    expect(ledger.bySubject("cpu").length).toBeGreaterThanOrEqual(7);
  });

  it("精确事实必须有来源：catalog/price/rule 无来源即违规，其余类别豁免", () => {
    expect(validateClaim(claimOf("catalog_fact", { sourceIds: [] }))).not.toBeNull();
    expect(validateClaim(claimOf("price_fact", { sourceIds: [] }))).not.toBeNull();
    expect(validateClaim(claimOf("rule_result", { sourceIds: [] }))).not.toBeNull();
    expect(validateClaim(claimOf("catalog_fact", { sourceIds: ["cpu-9800x3d"] }))).toBeNull();
    expect(validateClaim(claimOf("user_fact", { sourceIds: [] }))).toBeNull();
    expect(validateClaim(claimOf("experience_advice", { sourceIds: [] }))).toBeNull();
    expect(validateClaim(claimOf("unknown", { sourceIds: [] }))).toBeNull();
    expect(validateClaim(claimOf("question", { sourceIds: [] }))).toBeNull();
  });

  it("账本 validate 汇总全部违规", () => {
    const ledger = new ClaimLedger();
    ledger.add(claimOf("catalog_fact", { subject: "cpu", sourceIds: ["cpu-9800x3d"] }));
    ledger.add(claimOf("price_fact", { subject: "gpu", sourceIds: [] }));
    const violations = ledger.validate();
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toContain("price_fact");
  });
});

describe("方案 grounding 验证器（v2 Phase 5）", () => {
  it("有来源的 catalog/price 主张全部通过，规则结果以规则号为源入账", () => {
    const report = validateProposalGrounding({
      proposal: proposalOf([itemOf()]),
      priceByCanonicalId: new Map([["cpu-9800x3d", { canonicalProductId: "cpu-9800x3d", priceCents: 359_900, evidenceIds: ["pe-1"], capturedAt: "2026-10-09T00:00:00.000Z" }]]),
      findings: [
        {
          ruleId: "R-CPU-MB-001",
          status: "unknown",
          itemIds: [],
          conclusion: "缺少主板无法判断",
          evidence: [],
          dataDate: null,
          confidence: "low",
          assumptions: [],
          missingFields: [],
          suggestedAction: "补主板",
        },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.blocking).toEqual([]);
    const kinds = report.claims.map((claim) => claim.kind);
    expect(kinds).toContain("catalog_fact");
    expect(kinds).toContain("price_fact");
    expect(kinds).toContain("rule_result");
  });

  it("price_fact 缺证据来源：降级为 unknown 而不是阻止回答", () => {
    const proposal = proposalOf([itemOf()]);
    const report = validateProposalGrounding({
      proposal,
      priceByCanonicalId: new Map(),
    });
    expect(report.ok).toBe(true);
    expect(report.downgradedCategories).toEqual(["cpu"]);
    const downgraded = downgradeUnverifiedPrices(proposal, report.downgradedCategories);
    expect(downgraded.items[0]!.priceEstimateLowCents).toBeNull();
    expect(downgraded.items[0]!.priceBasis).toBe("unknown");
  });

  it("catalog_fact 缺来源（无 catalogId）：阻塞回答", () => {
    const report = validateProposalGrounding({
      proposal: proposalOf([itemOf({ catalogId: undefined, label: "商家自拟型号" })]),
      priceByCanonicalId: new Map(),
    });
    expect(report.ok).toBe(false);
    expect(report.blocking.length).toBeGreaterThan(0);
    expect(report.blocking[0]!.reason).toContain("catalog_fact");
  });
});
