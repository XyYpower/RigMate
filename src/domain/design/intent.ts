import { z } from "zod";
import { designRequestInputSchema, structuredIntentSchema, type StructuredIntent } from "@/contracts/design";

const budgetPatterns = [
  /(?:预算|预算是|预算约|预算为)\s*(?:人民币|¥|￥)?\s*([\d.]+)\s*(万|w|千|元)?/i,
  /([\d.]+)\s*(万|w|千|元)\s*(?:预算)?/i,
  // 数字在前："8000 预算"、"8000元预算"
  /(?:人民币|¥|￥)?\s*([\d.]+)\s*(万|w|千|元)?\s*预算/i,
];

function parseBudgetCents(input: string): number | null {
  const match = budgetPatterns.map((pattern) => input.match(pattern)).find(Boolean);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === "万" || unit === "w") return Math.round(amount * 10000 * 100);
  if (unit === "千") return Math.round(amount * 1000 * 100);
  if (unit === "元") return Math.round(amount * 100);
  // 无单位（"预算 1.5"）：歧义不猜——只有明显是元（≥1000）才认，对齐修订通道 parseBudgetRevision
  return amount >= 1000 ? Math.round(amount * 100) : null;
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

/**
 * 渐进式意图澄清（agent 对话策略）：出方案前必须知道用途和预算；
 * 外观是加分项，缺了不阻塞。追问按缺口精准问、一次只问一件事。
 */
export function intentNeedsInput(intent: StructuredIntent): boolean {
  return intent.useCases.length === 0 || intent.budgetCents === null;
}

/** 按缺口生成一句针对性的追问（用途 → 预算 → 外观，一次只推进一个缺口） */
export function followupQuestionFor(intent: StructuredIntent): string {
  if (intent.useCases.length === 0) {
    return "先聊聊用途吧——这台机器主要拿来干什么？比如 3A 游戏、视频剪辑、写代码；外观有偏好也可以一起说（白色、海景房、安静都行）。";
  }
  if (intent.budgetCents === null) {
    return `用途记下了（${intent.useCases.join("、")}）。预算大概什么范围？说个整数就行，比如「预算 8 千」「2 万以内」。`;
  }
  if (intent.appearance.length === 0) {
    return `预算 ${Math.round(intent.budgetCents / 100)} 元配${intent.useCases.join("、")}没问题。外观有偏好吗？比如白色、海景房、安静——没有就直接开始搭配。`;
  }
  return "目标清楚了，开始检索目录。";
}

export const designIntentSchema = z.object({
  rawInput: z.string().trim().min(3).max(4000),
  budgetCents: z.number().int().positive().nullable().optional(),
  region: z.string().trim().min(1).max(40).optional(),
});
