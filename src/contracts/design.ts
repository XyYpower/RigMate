import { z } from "zod";
import { buildItemCategorySchema, findingStatusSchema } from "@/domain/build/types";
import { fieldQualityStatusSchema, publishStatusSchema } from "@/domain/catalog/quality";

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
  /** 有参考资料目录型号（质量门 supported）：可用但未经人工核验，绝不冒充 verified */
  "supported_catalog",
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
  /** 中文展示名（展示层，响应时由目录解析后附加）；label 本身不被改写 */
  displayName: z.string().trim().min(1).max(200).optional(),
  /** 英文原名，供界面 title 悬停与溯源 */
  displayNameOriginal: z.string().trim().min(1).max(200).optional(),
  spec: z.record(z.string(), z.unknown()),
  sourceLevel: sourceLevelSchema,
  /** 证据链上的产品级质量状态（仅 verified/supported 可进入方案；旧引擎历史行缺省 unknown） */
  qualityStatus: publishStatusSchema.or(z.literal("unknown")).default("unknown"),
  /** 支撑该部件规格的字段证据状态（spec 字段 → 质量状态）；无证据链时为空 = 无质量层 */
  fieldQuality: z.record(z.string(), fieldQualityStatusSchema).default({}),
  /** 支撑该部件规格的证据来源（product_sources.id） */
  evidenceSourceIds: z.array(z.string().trim().min(1)).max(40).default([]),
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

export const experienceAdviceKindSchema = z.enum(["experience_advice", "external_product_hint"]);

/**
 * 模型建议项（混合建议层）：经验取舍或数据库外产品线索。
 * 红线：不携带价格、规格、接口、功耗、兼容结论——strict schema 下的未知字段一律拒绝；
 * external_product_hint 必须带产品名且 requiresVerification=true，只能进待验证队列，绝不映射为正式配置。
 */
export const experienceAdviceItemSchema = z
  .object({
    kind: experienceAdviceKindSchema,
    category: buildItemCategorySchema,
    title: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(500),
    productName: z.string().trim().min(1).max(160).optional(),
    requiresVerification: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "external_product_hint") {
      if (!value.productName) {
        ctx.addIssue({ code: "custom", path: ["productName"], message: "数据库外产品提示必须有产品名" });
      }
      if (!value.requiresVerification) {
        ctx.addIssue({
          code: "custom",
          path: ["requiresVerification"],
          message: "数据库外产品提示必须标记 requiresVerification=true",
        });
      }
    }
    if (value.kind === "experience_advice" && value.productName) {
      ctx.addIssue({ code: "custom", path: ["productName"], message: "经验建议不能携带未验证产品名" });
    }
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
  /** 模型建议（独立通道）：不参与价格合计、兼容检查与接受写路径 */
  experienceAdvice: z.array(experienceAdviceItemSchema).max(8).default([]),
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

/**
 * 回答层契约（M4，blueprint §7.4）：回答只能引用已存在的事实与建议项
 * （claimIds/adviceIds 为引用，文本由渲染器从 summary/actions 生成），strict——
 * 模型不产出回答文案，数字与型号全部来自方案事实。
 */
export const answerDraftSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),
    actions: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
    questions: z.array(z.string().trim().min(1).max(200)).max(2).default([]),
    claimIds: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
    adviceIds: z.array(z.number().int().nonnegative()).max(8).default([]),
  })
  .strict();
export type AnswerDraft = z.infer<typeof answerDraftSchema>;

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
export type ExperienceAdviceKind = z.infer<typeof experienceAdviceKindSchema>;
export type ExperienceAdviceItem = z.infer<typeof experienceAdviceItemSchema>;

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
  /** 当前请求下按版本升序排列的全部方案，供历史只读查看 */
  versions: DesignProposal[];
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
