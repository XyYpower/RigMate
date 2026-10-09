import { createClaim, ClaimLedger, validateClaim } from "@/domain/agent/claims";
import type { AgentClaim, ClaimViolation } from "@/contracts/agent";
import type { DesignProposal, ProposalItem } from "@/contracts/design";
import type { VerifiedPriceFact } from "@/domain/catalog/ranking";
import type { Finding } from "@/domain/build/types";

/**
 * 方案 grounding 验证器（v2 Phase 5 §8 Claim Ledger 的消费方）。
 *
 * 方案的每一类精确主张都入账并校验来源：
 * - catalog_fact：方案项 → 来源 = canonicalId（目录产品）+ 字段证据来源引用；
 * - price_fact：有证据价格的项目 → 来源 = price_evidence.id；
 * - rule_result：每条兼容发现 → 来源 = 规则号。
 * 验证失败：price_fact 缺来源 → 降级为 unknown（价格清空）；其余违规 → 阻止回答。
 */
export type GroundingReport = {
  ok: boolean;
  claims: readonly AgentClaim[];
  violations: readonly ClaimViolation[];
  /** 因验证失败被降级为 unknown 的项目类别 */
  downgradedCategories: readonly string[];
  /** 无法降级、必须阻止回答的违规 */
  blocking: readonly ClaimViolation[];
};

function claimsForItem(item: ProposalItem, prices: Map<string, VerifiedPriceFact>, attemptId: string | null): AgentClaim[] {
  const claims: AgentClaim[] = [];
  claims.push(
    createClaim({
      kind: "catalog_fact",
      subject: item.category,
      statement: `${item.category} 选择 ${item.label}（${item.qualityStatus}）`,
      sourceIds: [...(item.catalogId ? [item.catalogId] : []), ...item.evidenceSourceIds],
      attemptId,
    }),
  );
  if (item.priceBasis === "evidence" && item.catalogId) {
    const price = prices.get(item.catalogId);
    claims.push(
      createClaim({
        kind: "price_fact",
        subject: item.category,
        statement: `${item.category} 已审核价格 ¥${((item.priceEstimateLowCents ?? 0) / 100).toLocaleString("zh-CN")}`,
        sourceIds: price?.evidenceIds ?? [],
        attemptId,
      }),
    );
  }
  return claims;
}

export function validateProposalGrounding(input: {
  proposal: DesignProposal;
  priceByCanonicalId: Map<string, VerifiedPriceFact>;
  findings?: readonly Finding[];
  attemptId?: string | null;
}): GroundingReport {
  const ledger = new ClaimLedger();
  const violations: ClaimViolation[] = [];
  const blocking: ClaimViolation[] = [];
  const downgraded = new Set<string>();

  for (const item of input.proposal.items) {
    for (const claim of claimsForItem(item, input.priceByCanonicalId, input.attemptId ?? null)) {
      ledger.add(claim);
      const violation = validateClaim(claim);
      if (!violation) continue;
      violations.push(violation);
      if (claim.kind === "price_fact") {
        downgraded.add(item.category);
      } else {
        blocking.push(violation);
      }
    }
  }
  for (const finding of input.findings ?? []) {
    ledger.add(
      createClaim({
        kind: "rule_result",
        subject: finding.ruleId,
        statement: finding.conclusion,
        sourceIds: [finding.ruleId],
        attemptId: input.attemptId ?? null,
      }),
    );
  }

  return {
    ok: blocking.length === 0,
    claims: ledger.all(),
    violations,
    downgradedCategories: [...downgraded],
    blocking,
  };
}

/** 降级：把未通过 price_fact 验证的项目价格清成 unknown（未知不是猜测） */
export function downgradeUnverifiedPrices(proposal: DesignProposal, categories: readonly string[]): DesignProposal {
  if (categories.length === 0) return proposal;
  return {
    ...proposal,
    items: proposal.items.map((item) =>
      categories.includes(item.category)
        ? { ...item, priceEstimateLowCents: null, priceEstimateHighCents: null, priceBasis: "unknown" as const }
        : item,
    ),
  };
}
