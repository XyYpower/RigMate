import { z } from "zod";
import { structuredIntentSchema, type StructuredIntent } from "@/contracts/design";
import { completeJson, type LlmConfig, type LlmJsonResult } from "@/infra/llm/client";
import type { CatalogEntry } from "@/domain/catalog/seed";
import type { BuildItemCategory } from "@/domain/build/types";

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
  return { ok: true, data: mapLlmIntent(result.data, input.explicitBudgetYuan) };
}

function mapLlmIntent(data: z.infer<typeof llmIntentOutputSchema>, explicitBudgetYuan: number | null): StructuredIntent {
  const budgetCents =
    explicitBudgetYuan !== null
      ? Math.round(explicitBudgetYuan * 100)
      : data.budgetYuan !== null
        ? Math.round(data.budgetYuan * 100)
        : null;
  return structuredIntentSchema.parse({
    budgetCents,
    useCases: data.useCases,
    appearance: data.appearance,
    existingParts: data.existingParts,
    constraints: data.constraints,
    region: data.region,
  });
}

export const REVISION_SYSTEM_PROMPT = `你是装机助手的方案调整器。给你当前方案的意图 JSON 和用户的调整要求，输出调整后的完整意图 JSON（字段与输入一致：budgetYuan/useCases/appearance/existingParts/constraints/region）。规则：
- 只修改用户提到的字段，未提及的字段原样保留；
- budgetYuan 用数字（元），"预算 1.8 万"=18000；用户没提预算就保持原值；
- 用户说已有某硬件（如"我已有电源"）→ 在 existingParts 加入该类别名（如"电源"），表示方案不再包含该类购置；
- 只输出 JSON，不要解释或代码围栏；绝不编造用户没提的偏好。`;

export async function reviseIntentWithLlm(input: {
  currentIntent: StructuredIntent;
  instruction: string;
  config: LlmConfig;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}): Promise<LlmJsonResult<StructuredIntent>> {
  const result = await completeJson({
    config: input.config,
    system: REVISION_SYSTEM_PROMPT,
    user: `当前意图：${JSON.stringify({
      budgetYuan: input.currentIntent.budgetCents === null ? null : input.currentIntent.budgetCents / 100,
      useCases: input.currentIntent.useCases,
      appearance: input.currentIntent.appearance,
      existingParts: input.currentIntent.existingParts,
      constraints: input.currentIntent.constraints,
      region: input.currentIntent.region,
    })}\n调整要求：${input.instruction}`,
    schema: llmIntentOutputSchema,
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) return result;
  return { ok: true, data: mapLlmIntent(result.data, null) };
}

const llmSelectionOutputSchema = z.object({
  selections: z.array(z.object({
    category: z.string().trim().min(1).max(40),
    catalogId: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(300),
  })).max(8).default([]),
});

export type CatalogSelection = {
  selectedIds: Partial<Record<BuildItemCategory, string>>;
  rationaleByCategory: Partial<Record<BuildItemCategory, string>>;
};

const CATEGORIES: BuildItemCategory[] = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"];

export const CATALOG_SELECTION_SYSTEM_PROMPT = `你是受约束的装机候选选择器。你只能从用户提供的 catalogId 中选择，不能创造型号、规格、价格或新的 ID。只输出 JSON：{"selections":[{"category":"cpu","catalogId":"已有 ID","reason":"一句选择理由"}]}。每个类别最多选一个，缺少合适候选时不要选择。`;

export function renderCatalogSelectionPrompt(input: {
  intent: StructuredIntent;
  candidates: CatalogEntry[];
}): string {
  return `用户意图：${JSON.stringify(input.intent)}\n可选目录候选：${JSON.stringify(input.candidates.map((entry) => ({
    id: entry.id,
    category: entry.category,
    name: entry.name,
    aliases: entry.aliases,
    spec: entry.spec,
  })))}\n请只在这些候选中选择。`;
}

export async function selectCatalogCandidatesWithLlm(input: {
  intent: StructuredIntent;
  candidates: CatalogEntry[];
  config: LlmConfig;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}): Promise<LlmJsonResult<CatalogSelection>> {
  const result = await completeJson({
    config: input.config,
    system: CATALOG_SELECTION_SYSTEM_PROMPT,
    user: renderCatalogSelectionPrompt(input),
    schema: llmSelectionOutputSchema,
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) return result;
  const allowed = new Map(input.candidates.map((entry) => [entry.id, entry]));
  const selectedIds: Partial<Record<BuildItemCategory, string>> = {};
  const rationaleByCategory: Partial<Record<BuildItemCategory, string>> = {};
  for (const selection of result.data.selections) {
    if (!CATEGORIES.includes(selection.category as BuildItemCategory)) continue;
    const entry = allowed.get(selection.catalogId);
    if (!entry || entry.category !== selection.category) return { ok: false, reason: "模型选择了不存在的目录型号" };
    const category = entry.category;
    if (selectedIds[category]) continue;
    selectedIds[category] = entry.id;
    rationaleByCategory[category] = selection.reason;
  }
  return { ok: true, data: { selectedIds, rationaleByCategory } };
}
