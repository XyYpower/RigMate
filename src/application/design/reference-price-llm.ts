import { z } from "zod";
import { referencePriceItemSchema, type ReferencePriceItem } from "@/contracts/design";
import { completeJson, type LlmConfig, type LlmJsonResult } from "@/infra/llm/client";
import type { BuildItemCategory } from "@/domain/build/types";
import { getAgentPrompt } from "@/application/agent/prompts/registry";

/**
 * 参考价层（规格 v1 §价格）：独立的估算 LLM 通道，与 advice 同批后台任务。
 *
 * 输出只有按类别的估算参考价——绝不触碰 items 的 priceCents，绝不产生配置或兼容结论；
 * strict schema 下的越权字段与不存在的类别一律校验失败，调用方降级为"无参考价"。
 */

const REFERENCE_PRICE_PROMPT_VERSION = getAgentPrompt("reference-price").version;
const REFERENCE_PRICE_SYSTEM_PROMPT = getAgentPrompt("reference-price").system;

const llmReferencePriceOutputSchema = z
  .object({
    prices: z.array(referencePriceItemSchema).max(8).default([]),
  })
  .strict();

export function renderReferencePricePrompt(input: {
  items: Array<{ category: BuildItemCategory; label: string }>;
  budgetCents: number | null;
}): string {
  return `正式方案配件（category + 型号名）：${JSON.stringify(input.items)}
用户预算（元）：${input.budgetCents === null ? "未设置" : input.budgetCents / 100}
请为每个配件输出人民币参考价估算（priceCents = 元 × 100），没有把握的类别跳过。`;
}

export async function generateReferencePrices(input: {
  items: Array<{ category: BuildItemCategory; label: string }>;
  budgetCents: number | null;
  config: LlmConfig;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  /** 非阻塞估算输出：思考会耗尽输出预算，缺省强制关闭 */
  thinking?: "enabled" | "disabled";
  maxTokens?: number;
}): Promise<LlmJsonResult<ReferencePriceItem[]>> {
  const result = await completeJson({
    config: input.config,
    system: REFERENCE_PRICE_SYSTEM_PROMPT,
    user: renderReferencePricePrompt(input),
    schema: llmReferencePriceOutputSchema,
    thinking: input.thinking ?? "disabled",
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.prices };
}

export { REFERENCE_PRICE_PROMPT_VERSION };
