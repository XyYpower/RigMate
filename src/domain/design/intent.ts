import { z } from "zod";
import { designRequestInputSchema, structuredIntentSchema, type StructuredIntent } from "@/contracts/design";

const budgetPatterns = [
  /(?:预算|预算是|预算约|预算为)\s*(?:人民币|¥|￥)?\s*([\d.]+)\s*(万|w|千|元)?/i,
  /([\d.]+)\s*(万|w|千|元)\s*(?:预算)?/i,
];

function parseBudgetCents(input: string): number | null {
  const match = budgetPatterns.map((pattern) => input.match(pattern)).find(Boolean);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2]?.toLowerCase();
  const multiplier = unit === "万" || unit === "w" ? 10000 : unit === "千" ? 1000 : 1;
  return Math.round(amount * multiplier * 100);
}

function collectMatches(input: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns.filter(([pattern]) => pattern.test(input)).map(([, label]) => label);
}

export function parseDesignIntent(input: unknown): StructuredIntent {
  const data = designRequestInputSchema.parse(input);
  const raw = data.rawInput;
  const useCases = collectMatches(raw, [
    [/剪辑|视频|Premiere|PR|达芬奇|影视/i, "视频剪辑"],
    [/游戏|电竞|steam|原神|3A/i, "游戏"],
    [/开发|编程|代码|虚拟机/i, "开发"],
    [/办公|文档|网课/i, "办公"],
  ]);
  const appearance = collectMatches(raw, [
    [/白色|白配|纯白/i, "白色"],
    [/海景房|侧透|玻璃/i, "海景房"],
    [/静音|安静|噪音低/i, "低噪音"],
    [/RGB|灯效|灯带/i, "灯效"],
  ]);
  const existingParts = [...raw.matchAll(/(?:已有|保留|手里有|现有)\s*([^，。；\n]+)/g)].map((match) => match[1]!.trim()).filter(Boolean);
  const constraints = collectMatches(raw, [
    [/不要水冷|不想要水冷/i, "不使用水冷"],
    [/不要灯|无灯|不需要RGB/i, "不需要灯效"],
    [/静音|安静|噪音低/i, "优先安静"],
    [/显存|剪辑/i, "关注显存和生产力"],
  ]);

  return structuredIntentSchema.parse({
    budgetCents: data.budgetCents ?? parseBudgetCents(raw),
    useCases: [...new Set(useCases)],
    appearance: [...new Set(appearance)],
    existingParts,
    constraints: [...new Set(constraints)],
    region: data.region,
  });
}

export function designTitle(intent: StructuredIntent): string {
  const appearance = intent.appearance.slice(0, 2).join(" · ");
  const useCase = intent.useCases.slice(0, 2).join(" + ");
  return [appearance, useCase].filter(Boolean).join(" · ") || "自定义装机方案";
}

export function intentNeedsInput(intent: StructuredIntent): boolean {
  return intent.budgetCents === null && intent.useCases.length === 0;
}

export const designIntentSchema = z.object({
  rawInput: z.string().trim().min(3).max(4000),
  budgetCents: z.number().int().positive().nullable().optional(),
  region: z.string().trim().min(1).max(40).optional(),
});
