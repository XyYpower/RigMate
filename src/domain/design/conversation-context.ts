import { z } from "zod";
import { structuredIntentSchema, type DesignProposal, type StructuredIntent } from "@/contracts/design";

/**
 * 统一会话上下文（launch-readiness §5.2 / blueprint M1）。
 *
 * 服务端为每轮修订生成的结构化摘要：模型只收到这份摘要和最近两轮用户消息，
 * 绝不把完整事件历史塞给模型——完整事件留在 agent_event_log 用于审计与回放。
 * strict schema：上下文之外的键一律拒绝，防止提示词注入面扩散。
 */

export const conversationFindingSchema = z.object({
  ruleId: z.string().trim().min(1).max(60),
  status: z.string().trim().min(1).max(20),
  conclusion: z.string().trim().min(1).max(300),
});

export const conversationContextSchema = z
  .object({
    requestId: z.string().uuid(),
    /** 本轮序号：创建 = 1，此后每次用户动作 +1 */
    turn: z.number().int().positive(),
    intent: structuredIntentSchema,
    /** 用户明确确认过的字段路径（如 ["budgetCents"]）；模型推断不进这里 */
    confirmedFields: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    /** 上一轮系统追问；用户作答后置 null */
    pendingQuestion: z.string().trim().min(1).max(500).nullable(),
    latestProposal: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        selectedIds: z.array(z.string().trim().min(1).max(160)).max(8),
      })
      .nullable(),
    latestTradeoffs: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
    /** 规则发现摘要：兼容结论 + 每条未知字段，状态如实（unknown 不冒充通过） */
    latestFindings: z.array(conversationFindingSchema).max(16).default([]),
    /** 短期语境：只保留最近两轮用户消息（blueprint §3.1） */
    recentUserMessages: z.array(z.string().trim().min(1).max(2000)).max(2),
  })
  .strict();

export type ConversationFinding = z.infer<typeof conversationFindingSchema>;
export type ConversationContext = z.infer<typeof conversationContextSchema>;

export type ConversationContextInput = {
  requestId: string;
  turn: number;
  intent: StructuredIntent;
  latestProposal?: DesignProposal | null;
  /** 用户明确确认过的字段路径 */
  confirmedFields?: string[];
  pendingQuestion?: string | null;
  /** 截止本轮的用户消息序列（构建器只保留最近两条） */
  userMessages?: string[];
};

export function buildConversationContext(input: ConversationContextInput): ConversationContext {
  const proposal = input.latestProposal ?? null;
  const findings: ConversationFinding[] = [];
  if (proposal) {
    if (proposal.compatibility.message) {
      findings.push({
        ruleId: "compatibility",
        status: proposal.compatibility.status,
        conclusion: proposal.compatibility.message,
      });
    }
    for (const unknown of proposal.unknowns) {
      findings.push({ ruleId: "missing_field", status: "unknown", conclusion: unknown });
    }
  }
  return conversationContextSchema.parse({
    requestId: input.requestId,
    turn: input.turn,
    intent: input.intent,
    confirmedFields: input.confirmedFields ?? [],
    pendingQuestion: input.pendingQuestion ?? null,
    latestProposal: proposal
      ? {
          id: proposal.id,
          version: proposal.version,
          selectedIds: proposal.items
            .map((item) => item.catalogId)
            .filter((id): id is string => Boolean(id))
            .slice(0, 8),
        }
      : null,
    latestTradeoffs: proposal?.tradeoffs ?? [],
    latestFindings: findings,
    recentUserMessages: (input.userMessages ?? []).slice(-2),
  });
}
