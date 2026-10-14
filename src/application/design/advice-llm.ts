import { z } from "zod";
import {
  experienceAdviceItemSchema,
  type CompatibilitySummary,
  type ExperienceAdviceItem,
  type StructuredIntent,
} from "@/contracts/design";
import { completeJson, type LlmConfig, type LlmJsonResult } from "@/infra/llm/client";
import type { BuildItemCategory } from "@/domain/build/types";
import type { CandidateSummary } from "@/domain/catalog/ranking";
import { getAgentPrompt } from "@/application/agent/prompts/registry";

/**
 * 混合建议层（hybrid-llm-advice 计划 Task 2）：独立的 advice LLM 通道。
 *
 * 正式方案生成完毕后非阻塞调用；输出只有带来源标签的建议项（经验建议 / 库外产品提示），
 * 绝不产生正式配置、价格或兼容结论——schema 复用 contracts 的 experienceAdviceItemSchema，
 * 越权字段（价格/规格/接口）与不存在的类别一律校验失败，调用方降级为"无建议"。
 */

const ADVICE_PROMPT_VERSION = getAgentPrompt("advice").version;
const ADVICE_SYSTEM_PROMPT = getAgentPrompt("advice").system;

/** 传给建议调用的方案摘要：只有标题、预算、条目名称和兼容摘要，不暴露数据库行 */
export type AdviceProposalSummary = {
  title: string;
  budgetCents: number | null;
  items: Array<{ category: BuildItemCategory; label: string }>;
  compatibility: CompatibilitySummary;
};

/** 严格输出 schema：suggestions 之外的任何键（越权字段）都让校验失败 */
const llmAdviceOutputSchema = z
  .object({
    suggestions: z.array(experienceAdviceItemSchema).max(4).default([]),
  })
  .strict();

/** 候选只作背景参考：每类最多 4 条，只透出名称与质量状态（Task 3 的输入边界在此收口） */
const CANDIDATES_PER_CATEGORY = 4;

export function renderAdvicePrompt(input: {
  intent: StructuredIntent;
  proposal: AdviceProposalSummary;
  candidates: readonly CandidateSummary[];
}): string {
  const perCategory = new Map<BuildItemCategory, CandidateSummary[]>();
  for (const candidate of input.candidates) {
    const bucket = perCategory.get(candidate.category) ?? [];
    if (bucket.length >= CANDIDATES_PER_CATEGORY) continue;
    bucket.push(candidate);
    perCategory.set(candidate.category, bucket);
  }
  return `用户意图：${JSON.stringify(input.intent)}
正式方案（已由目录与规则确认，不需要你重复选择）：${JSON.stringify({
    title: input.proposal.title,
    budgetYuan: input.proposal.budgetCents === null ? null : input.proposal.budgetCents / 100,
    items: input.proposal.items.map((item) => ({ category: item.category, label: item.label })),
    compatibility: input.proposal.compatibility,
  })}
目录当前候选（均通过质量门，仅供了解目录覆盖）：${JSON.stringify(
    [...perCategory.values()].flat().map((candidate) => ({
      category: candidate.category,
      name: candidate.name,
      qualityStatus: candidate.qualityStatus,
    })),
  )}
请按系统规则输出经验建议或数据库外产品提示，没有就输出空数组。`;
}

export async function generateExperienceAdvice(input: {
  intent: StructuredIntent;
  proposal: AdviceProposalSummary;
  candidates: readonly CandidateSummary[];
  config: LlmConfig;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  /** 建议是非阻塞经验输出：思考模型的输出预算不能被思考耗尽，缺省强制关闭 */
  thinking?: "enabled" | "disabled";
  maxTokens?: number;
}): Promise<LlmJsonResult<ExperienceAdviceItem[]>> {
  const result = await completeJson({
    config: input.config,
    system: ADVICE_SYSTEM_PROMPT,
    user: renderAdvicePrompt({
      intent: input.intent,
      proposal: input.proposal,
      candidates: input.candidates,
    }),
    schema: llmAdviceOutputSchema,
    thinking: input.thinking ?? "disabled",
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.suggestions };
}

export { ADVICE_PROMPT_VERSION };
