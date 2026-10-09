import { z } from "zod";

/**
 * Agent Runtime 契约（v2 Phase 5 §8）。
 *
 * Claim Ledger 的七类主张：catalog_fact / price_fact / rule_result / user_fact /
 * experience_advice / unknown / question。
 * 纪律：精确事实（catalog_fact / price_fact / rule_result）必须有 ≥1 个 sourceId，
 * 否则验证失败——降级 unknown 或阻止回答；user_fact / experience_advice / unknown /
 * question 不承载精确事实，无需来源。
 */

export const claimKindSchema = z.enum([
  "catalog_fact",
  "price_fact",
  "rule_result",
  "user_fact",
  "experience_advice",
  "unknown",
  "question",
]);
export type ClaimKind = z.infer<typeof claimKindSchema>;

/** 必须携带来源的精确主张 */
export const PRECISE_CLAIM_KINDS = ["catalog_fact", "price_fact", "rule_result"] as const;
export type PreciseClaimKind = (typeof PRECISE_CLAIM_KINDS)[number];

export const agentClaimSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: claimKindSchema,
  /** 主张主体：类别 / 产品 / 字段 / 规则号（如 "gpu"、"cpu-9800x3d"、"R-CPU-MB-001"） */
  subject: z.string().trim().min(1).max(200),
  /** 一句话陈述；unknown/question 可以是给用户的话 */
  statement: z.string().trim().min(1).max(500),
  /** 来源引用：canonicalId / price_evidence.id / 规则号 / 用户输入标记 */
  sourceIds: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
  /** 产生该主张的尝试（模型/规则）；无归属时为 null */
  attemptId: z.string().trim().min(1).max(80).nullable().default(null),
  createdAt: z.string().datetime(),
});
export type AgentClaim = z.infer<typeof agentClaimSchema>;

export const claimViolationSchema = z.object({
  claimId: z.string(),
  reason: z.string().trim().min(1).max(300),
});
export type ClaimViolation = z.infer<typeof claimViolationSchema>;
