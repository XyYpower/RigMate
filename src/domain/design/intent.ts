import { z } from "zod";
import { designRequestInputSchema, structuredIntentSchema, type StructuredIntent } from "@/contracts/design";

const budgetPatterns = [
  // 大概/左右等口语填充词不阻断匹配（M5 评测缺口）
  /(?:预算|预算是|预算约|预算为)\s*(?:大概|大约|差不多|左右)?\s*(?:人民币|¥|￥)?\s*([\d.]+)\s*(万|w|千|元)?(?:左右|上下|以内)?/i,
  /([\d.]+)\s*(万|w|千|元)\s*(?:左右|上下|以内)?\s*(?:预算)?/i,
  // 数字在前："8000 预算"、"8000元预算"
  /(?:人民币|¥|￥)?\s*([\d.]+)\s*(万|w|千|元)?\s*预算/i,
];

/** 中文数字归一（预算解析专用）："两万"→"2万"（M5 评测缺口） */
const CHINESE_DIGIT: Record<string, string> = { 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };

function normalizeBudgetText(input: string): string {
  return input.replace(/[一二两三四五六七八九]\s*万/g, (matched) => {
    const digit = CHINESE_DIGIT[matched[0]!] ?? matched[0]!;
    return `${digit}万`;
  });
}

function parseBudgetCents(input: string): number | null {
  const normalized = normalizeBudgetText(input);
  const match = budgetPatterns.map((pattern) => normalized.match(pattern)).find(Boolean);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === "万" || unit === "w") {
    // "2 万 5"/"2万5"：万后单个数字是千位尾数（M5 评测缺口）
    const tail = normalized.slice((match.index ?? 0) + match[0].length);
    const tailDigit = tail.match(/^\s*([1-9])/) ?? tail.match(/^\s*([五六七八九])/);
    if (tailDigit) {
      const tailValue = Number(CHINESE_DIGIT[tailDigit[1]!] ?? tailDigit[1]);
      return Math.round((amount + tailValue / 10) * 10000 * 100);
    }
    return Math.round(amount * 10000 * 100);
  }
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
    [/(?:ai|人工智能|stable\s*diffusion|sd|midjourney|mj)[\s]*(?:绘图|画画|作图|绘画)|绘图|画图/i, "AI 绘图"],
    [/直播|开播/i, "直播"],
  ]);
  const appearance = collectMatches(raw, [
    [/白色|白配|纯白/i, "白色"],
    [/海景房|侧透|玻璃/i, "海景房"],
    [/静音|安静|噪音低/i, "低噪音"],
    [/RGB|灯效|灯带/i, "灯效"],
  ]);
  const existingParts = [
    // 关键词前置："已有 4070S""手里有电源"
    ...[...raw.matchAll(/(?:已有|保留|手里有|现有)\s*([^，。；\n]+)/g)].map((match) => match[1]!.trim()),
    // 部件名前置（M5 评测缺口："机箱保留用旧的""显卡继续用"）
    ...[...raw.matchAll(/([^，。；\n]{1,16}?)\s*(?:保留|不用配|不要配|继续用|不用换)/g)].map((match) => match[1]!.trim()),
  ].filter(Boolean);
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
