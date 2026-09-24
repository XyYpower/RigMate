import { z } from "zod";
import { structuredIntentSchema, type StructuredIntent } from "@/contracts/design";
import { completeJson, type LlmConfig, type LlmJsonResult } from "@/infra/llm/client";

/**
 * LLM 意图解析（M30）：模型只负责把自然语言目标整理成结构化偏好；
 * 产出必须过 Zod 校验，且最终预算以表单显式输入优先。候选、价格、兼容事实
 * 不经过模型——那是目录和规则引擎的职责（业务规格 V2 §6.2/§10）。
 */

const llmIntentOutputSchema = z.object({
  budgetYuan: z.number().positive().nullable(),
  useCases: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  appearance: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  existingParts: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  constraints: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  region: z.string().trim().min(1).max(40).default("中国大陆"),
});

export const INTENT_SYSTEM_PROMPT = `你是装机助手的目标解析器。只输出一个 JSON 对象，不要输出任何解释或代码围栏。字段定义：
- budgetYuan：数字或 null。用户预算（人民币元），"2万"=20000，"8千"=8000，没提预算则 null。
- useCases：用途数组（如 游戏、视频剪辑、开发、办公、直播、AI 绘图），最多 8 个，没有则 []。
- appearance：外观与偏好数组（如 白色、海景房、静音、灯效、小型化），最多 8 个，没有则 []。
- existingParts：用户已有或要求保留的硬件数组，最多 20 个，没有则 []。
- constraints：其他约束或取舍数组（如 不要水冷、优先显存、控制噪音），最多 20 个，没有则 []。
- region：地区字符串，默认 "中国大陆"。
用户没有提到的信息一律用 null 或 []，绝不编造。`;

export function renderIntentUserPrompt(input: {
  rawInput: string;
  explicitBudgetYuan: number | null;
}): string {
  const budgetNote =
    input.explicitBudgetYuan !== null
      ? `\n（用户已在表单明确预算 ${input.explicitBudgetYuan} 元，budgetYuan 以此为准。）`
      : "";
  return `用户目标：${input.rawInput}${budgetNote}`;
}

export async function parseIntentWithLlm(input: {
  rawInput: string;
  /** 表单显式输入的预算（元），优先于模型提取 */
  explicitBudgetYuan: number | null;
  config: LlmConfig;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}): Promise<LlmJsonResult<StructuredIntent>> {
  const result = await completeJson({
    config: input.config,
    system: INTENT_SYSTEM_PROMPT,
    user: renderIntentUserPrompt({ rawInput: input.rawInput, explicitBudgetYuan: input.explicitBudgetYuan }),
    schema: llmIntentOutputSchema,
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) return result;
  const data = result.data;
  const budgetCents =
    input.explicitBudgetYuan !== null
      ? Math.round(input.explicitBudgetYuan * 100)
      : data.budgetYuan !== null
        ? Math.round(data.budgetYuan * 100)
        : null;
  return {
    ok: true,
    data: structuredIntentSchema.parse({
      budgetCents,
      useCases: data.useCases,
      appearance: data.appearance,
      existingParts: data.existingParts,
      constraints: data.constraints,
      region: data.region,
    }),
  };
}
