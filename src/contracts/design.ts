import { z } from "zod";
import { buildItemCategorySchema, findingStatusSchema } from "@/domain/build/types";

export const designRequestStatusSchema = z.enum([
  "received",
  "understanding",
  "needs_input",
  "generating",
  "ready_to_review",
  "accepted",
  "abandoned",
]);

export const proposalStatusSchema = z.enum([
  "draft",
  "validating",
  "needs_confirmation",
  "ready",
  "accepted",
  "replaced",
]);

export const agentRunStatusSchema = z.enum(["running", "completed", "failed"]);
export const agentEventTypeSchema = z.enum([
  "understanding",
  "retrieving",
  "composing",
  "validating",
  "question",
  "completed",
  "accepted",
  "failed",
]);
export const sourceLevelSchema = z.enum([
  "verified_catalog",
  "user_input",
  "price_evidence",
  "model_experience",
  "unknown",
]);

export const designRequestInputSchema = z.object({
  rawInput: z.string().trim().min(3).max(4000),
  budgetCents: z.number().int().positive().nullable().optional(),
  region: z.string().trim().min(1).max(40).default("中国大陆"),
});

export const designRevisionInputSchema = z.object({
  instruction: z.string().trim().min(2).max(500),
});

export const structuredIntentSchema = z.object({
  budgetCents: z.number().int().positive().nullable(),
  useCases: z.array(z.string().trim().min(1).max(40)).max(8),
  appearance: z.array(z.string().trim().min(1).max(40)).max(8),
  existingParts: z.array(z.string().trim().min(1).max(160)).max(20),
  constraints: z.array(z.string().trim().min(1).max(160)).max(20),
  region: z.string().trim().min(1).max(40),
});

export const proposalItemSchema = z.object({
  category: buildItemCategorySchema,
  label: z.string().trim().min(1).max(180),
  catalogId: z.string().trim().min(1).optional(),
  spec: z.record(z.string(), z.unknown()),
  sourceLevel: sourceLevelSchema,
  priceEstimateLowCents: z.number().int().positive().nullable(),
  priceEstimateHighCents: z.number().int().positive().nullable(),
  priceBasis: z.enum(["evidence", "experience_estimate", "unknown"]),
  rationale: z.string().trim().min(1).max(500),
  confirmationRequired: z.boolean(),
  confirmationReason: z.string().trim().max(300).optional(),
});

export const compatibilitySummarySchema = z.object({
  status: z.enum(["ok", "attention", "conflict", "unknown"]),
  message: z.string().trim().min(1).max(300),
  blockCount: z.number().int().nonnegative(),
  warnCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  passCount: z.number().int().nonnegative(),
});

export const designProposalSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  version: z.number().int().positive(),
  status: proposalStatusSchema,
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(1000),
  budgetCents: z.number().int().positive().nullable(),
  estimatedLowCents: z.number().int().positive().nullable(),
  estimatedHighCents: z.number().int().positive().nullable(),
  acceptedBuildId: z.string().uuid().nullable().optional(),
  items: z.array(proposalItemSchema).min(1),
  fitNotes: z.array(z.string().trim().min(1).max(300)).max(12),
  tradeoffs: z.array(z.string().trim().min(1).max(300)).max(12),
  unknowns: z.array(z.string().trim().min(1).max(300)).max(12),
  compatibility: compatibilitySummarySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const agentEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  type: agentEventTypeSchema,
  status: z.enum(["started", "completed", "waiting", "failed"]),
  message: z.string().trim().min(1).max(500),
  createdAt: z.string().datetime(),
});

export const proposalChangeSchema = z.object({
  category: buildItemCategorySchema,
  fromLabel: z.string().nullable(),
  toLabel: z.string().nullable(),
});

export type DesignRequestInput = z.infer<typeof designRequestInputSchema>;
export type DesignRequestStatus = z.infer<typeof designRequestStatusSchema>;
export type StructuredIntent = z.infer<typeof structuredIntentSchema>;
export type ProposalItem = z.infer<typeof proposalItemSchema>;
export type DesignProposal = z.infer<typeof designProposalSchema>;
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;
export type SourceLevel = z.infer<typeof sourceLevelSchema>;
export type ProposalChange = z.infer<typeof proposalChangeSchema>;
export type CompatibilitySummary = z.infer<typeof compatibilitySummarySchema>;

export type DesignRequest = {
  id: string;
  rawInput: string;
  intent: StructuredIntent;
  status: DesignRequestStatus;
  createdAt: string;
  updatedAt: string;
};

export type AgentRun = {
  id: string;
  requestId: string;
  proposalId: string | null;
  status: AgentRunStatus;
  createdAt: string;
  completedAt: string | null;
  events: AgentEvent[];
};

export type DesignResult = {
  request: DesignRequest;
  proposal: DesignProposal | null;
  run: AgentRun;
  /** 相对上一版本的按类别差异（第 1 版或信息不足时为空） */
  changes: ProposalChange[];
};

export function publicFindingStatus(status: z.infer<typeof findingStatusSchema>): string {
  switch (status) {
    case "block":
      return "冲突";
    case "warn":
      return "注意";
    case "unknown":
      return "资料不足";
    case "pass":
      return "可行";
    default:
      return "不适用";
  }
}
