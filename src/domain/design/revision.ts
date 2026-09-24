import type { BuildItemCategory } from "@/domain/build/types";
import type { StructuredIntent } from "@/contracts/design";

/**
 * 规则式意图修订（M31）：LLM 未配置时的降级通道。
 * 诚实边界——只处理两类最常见的调整：预算数字变化、已有硬件（该类不再购置）。
 * 其余自然语言调整没有模型时理解不了，明确返回失败交上层如实告知，绝不硬猜。
 */

const CATEGORY_KEYWORDS: Array<[RegExp, BuildItemCategory, string]> = [
  [/电源/, "psu", "电源"],
  [/显卡|gpu/i, "gpu", "显卡"],
  [/机箱/, "case", "机箱"],
  [/散热|水冷|风冷/, "cooler", "散热器"],
  [/内存/, "ram", "内存"],
  [/主板/, "motherboard", "主板"],
  [/cpu|处理器/i, "cpu", "处理器"],
  [/固态|硬盘|存储/, "storage", "存储"],
];

/** 从"已有硬件"描述中识别类别；识别不了的不猜 */
export function existingPartCategories(parts: string[]): BuildItemCategory[] {
  const found: BuildItemCategory[] = [];
  for (const part of parts) {
    for (const [pattern, category] of CATEGORY_KEYWORDS) {
      if (pattern.test(part)) {
        found.push(category);
        break;
      }
    }
  }
  return [...new Set(found)];
}

/** 修订语句中的预算：带单位（万/w/千/元）直接换算；无单位仅接受 ≥1000 的元值，避免把"1.8"这类歧义当事实 */
export function parseBudgetRevision(text: string): number | null {
  const match = text.match(/(?:预算|控制在|压到|压在|改成|调整为)\s*(?:人民币|¥|￥)?\s*([\d.]+)\s*(万|w|千|元)?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === "万" || unit === "w") return Math.round(amount * 10_000);
  if (unit === "千") return Math.round(amount * 1000);
  if (unit === "元") return Math.round(amount);
  // 无单位：只有明显是元（≥1000）才认
  return amount >= 1000 ? Math.round(amount) : null;
}

export type RuleRevisionResult =
  | { ok: true; intent: StructuredIntent; changes: string[] }
  | { ok: false };

export function reviseIntentWithRules(intent: StructuredIntent, instruction: string): RuleRevisionResult {
  const changes: string[] = [];
  const next: StructuredIntent = { ...intent };

  const budgetYuan = parseBudgetRevision(instruction);
  if (budgetYuan !== null && budgetYuan * 100 !== intent.budgetCents) {
    next.budgetCents = budgetYuan * 100;
    changes.push(`预算调整为 ${budgetYuan.toLocaleString("zh-CN")} 元`);
  }

  const categoryLabels = new Map(CATEGORY_KEYWORDS.map(([, category, label]) => [category, label]));
  for (const [pattern, category, label] of CATEGORY_KEYWORDS) {
    if (pattern.test(instruction) && /已有|保留|手里有|现有|不用?配/.test(instruction)) {
      const marked = `${label}（已有）`;
      if (!next.existingParts.some((part) => part.includes(label))) {
        next.existingParts = [...next.existingParts, marked];
        changes.push(`${categoryLabels.get(category) ?? label}按已有硬件处理，不再计入购置清单`);
      }
    }
  }

  if (changes.length === 0) return { ok: false };
  return { ok: true, intent: next, changes };
}
