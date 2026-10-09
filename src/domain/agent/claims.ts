import { randomUUID } from "node:crypto";
import { agentClaimSchema, PRECISE_CLAIM_KINDS, type AgentClaim, type ClaimKind, type ClaimViolation } from "@/contracts/agent";

/**
 * Claim Ledger（v2 Phase 5 §8，领域层纯函数）。
 *
 * 每个精确事实必须有 source IDs；验证失败时调用方（validator）负责降级 unknown
 * 或阻止回答。Ledger 本身是 append-only：只 add / query，不修改已入账主张。
 */

export function createClaim(input: {
  kind: ClaimKind;
  subject: string;
  statement: string;
  sourceIds?: string[];
  attemptId?: string | null;
}): AgentClaim {
  return agentClaimSchema.parse({
    id: `claim-${randomUUID()}`,
    kind: input.kind,
    subject: input.subject,
    statement: input.statement,
    sourceIds: input.sourceIds ?? [],
    attemptId: input.attemptId ?? null,
    createdAt: new Date().toISOString(),
  });
}

/** 单条主张校验：精确事实必须带来源 */
export function validateClaim(claim: AgentClaim): ClaimViolation | null {
  if ((PRECISE_CLAIM_KINDS as readonly string[]).includes(claim.kind) && claim.sourceIds.length === 0) {
    return {
      claimId: claim.id,
      reason: `精确事实 ${claim.kind}（${claim.subject}）缺少来源引用`,
    };
  }
  return null;
}

/** append-only 账本 */
export class ClaimLedger {
  private readonly entries: AgentClaim[] = [];

  add(claim: AgentClaim): AgentClaim {
    this.entries.push(claim);
    return claim;
  }

  addAll(claims: AgentClaim[]): AgentClaim[] {
    for (const claim of claims) this.add(claim);
    return claims;
  }

  all(): readonly AgentClaim[] {
    return this.entries;
  }

  byKind(kind: ClaimKind): AgentClaim[] {
    return this.entries.filter((claim) => claim.kind === kind);
  }

  bySubject(subject: string): AgentClaim[] {
    return this.entries.filter((claim) => claim.subject === subject);
  }

  /** 全账本校验：返回全部违规（空 = grounding 通过） */
  validate(): ClaimViolation[] {
    const violations: ClaimViolation[] = [];
    for (const claim of this.entries) {
      const violation = validateClaim(claim);
      if (violation) violations.push(violation);
    }
    return violations;
  }
}
