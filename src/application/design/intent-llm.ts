import { z } from "zod";
import { structuredIntentSchema, type StructuredIntent } from "@/contracts/design";
import { completeJson, type LlmConfig, type LlmJsonResult } from "@/infra/llm/client";
import type { CandidateSummary } from "@/domain/catalog/ranking";
import type { BuildItemCategory } from "@/domain/build/types";
import { getAgentPrompt } from "@/application/agent/prompts/registry";

/**
 * LLM 意图解析（M30）与受约束选件（M37 / 内核恢复计划 Task D）。
 *
 * 模型只负责把自然语言目标整理成结构化偏好、并在**质量门过滤后的候选摘要**里挑选；
 * 产出必须过 Zod 严格校验，候选、价格、兼容事实不经过模型。
 * 选件守卫（validateSelectionOutput）：非法 ID、类别不符、重复类别、质量不达标、
 * 越权字段（输出 schema 之外的键）一律拒绝，调用方回退规则式排序。
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

// ---- 受约束选件（Task D）----

/** 严格 schema：selections 之外的任何键（越权字段/编造规格）都会让校验失败 */
const llmSelectionOutputSchema = z.object({
  selections: z
    .array(
      z.object({
        category: z.string().trim().min(1).max(40),
        catalogId: z.string().trim().min(1).max(120),
        reason: z.string().trim().min(1).max(300),
      }),
    )
    .max(8)
    .default([]),
}).strict();

export type CatalogSelection = {
  selectedIds: Partial<Record<BuildItemCategory, string>>;
  rationaleByCategory: Partial<Record<BuildItemCategory, string>>;
};

const CATEGORIES: BuildItemCategory[] = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"];

/** 提示词原文与版本由 prompts/registry 管理（版本随 AgentEvent 落库） */
export const CATALOG_SELECTION_PROMPT_VERSION = getAgentPrompt("catalog-selection").version;
const CATALOG_SELECTION_SYSTEM_PROMPT = getAgentPrompt("catalog-selection").system;

/** 候选摘要 → 模型提示词：只透出 Task B 产出的有限字段，不暴露数据库或全量目录 */
export function renderCatalogSelectionPrompt(input: {
  intent: StructuredIntent;
  candidates: readonly CandidateSummary[];
}): string {
  return `用户意图：${JSON.stringify(input.intent)}\n可选候选（均已通过质量门）：${JSON.stringify(
    input.candidates.map((candidate) => ({
      catalogId: candidate.canonicalId,
      category: candidate.category,
      name: candidate.name,
      qualityStatus: candidate.qualityStatus,
      spec: candidate.spec,
      missingFields: candidate.missingFields,
      verifiedPriceCents: candidate.priceCents,
      retrievalReasons: candidate.retrievalReasons,
    })),
  )}\n请只在这些候选中选择。`;
}

/**
 * 选件守卫（纯函数，评测与运行时共用）：
 * - 非法 ID / 类别不符 / 质量状态缺失（候选池外）→ 整体拒绝；
 * - 重复类别 → 忽略后续（保留首个）；
 * - 未知类别 → 忽略该条；
 * 返回 ok=false 时调用方必须回退规则式排序。
 */
export function validateSelectionOutput(
  candidates: readonly CandidateSummary[],
  selections: Array<{ category: string; catalogId: string; reason: string }>,
): LlmJsonResult<CatalogSelection> {
  const allowed = new Map(candidates.map((candidate) => [candidate.canonicalId, candidate] as const));
  const selectedIds: Partial<Record<BuildItemCategory, string>> = {};
  const rationaleByCategory: Partial<Record<BuildItemCategory, string>> = {};
  for (const selection of selections) {
    if (!CATEGORIES.includes(selection.category as BuildItemCategory)) continue;
    const entry = allowed.get(selection.catalogId);
    if (!entry || entry.category !== selection.category) {
      return { ok: false, reason: "模型选择了候选列表之外的型号或不匹配的类别" };
    }
    if (entry.qualityStatus !== "verified" && entry.qualityStatus !== "supported") {
      return { ok: false, reason: "模型选择了未通过质量门的候选" };
    }
    const category = entry.category;
    if (selectedIds[category]) continue;
    selectedIds[category] = entry.canonicalId;
    rationaleByCategory[category] = selection.reason;
  }
  return { ok: true, data: { selectedIds, rationaleByCategory } };
}

export async function selectCatalogCandidatesWithLlm(input: {
  intent: StructuredIntent;
  candidates: readonly CandidateSummary[];
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
  return validateSelectionOutput(input.candidates, result.data.selections);
}
