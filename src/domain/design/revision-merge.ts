import type { StructuredIntent } from "@/contracts/design";
import { parseBudgetRevision } from "./revision";

/**
 * 修订合并守卫（launch-readiness Phase 2 / blueprint §3.2 §3.3）。
 *
 * 模型每轮返回完整意图，服务端只接受「用户明确触及的字段」的变化：
 * - 字段来源优先级：当前轮用户显式表达 > 之前用户确认 > 当前轮模型解析 > 之前模型推断 > 默认值；
 * - 预算有确定性解析器，显式预算永远压过模型值；
 * - 指令未触及的字段被模型改动 = 漂移，整体拒绝并记入 rejectedFields（不做部分合并）。
 * 每轮保存 before / instruction / model / merged / changed / rejected，用于定位模型理解错误。
 */

export const INTENT_FIELDS = [
  "budgetCents",
  "useCases",
  "appearance",
  "existingParts",
  "constraints",
  "region",
] as const;

export type IntentField = (typeof INTENT_FIELDS)[number];

/** 指令触达识别：宁可略宽松（多接受一个用户真的提到的字段），不可漏掉关键词 */
const TOUCH_PATTERNS: Array<[IntentField, RegExp]> = [
  ["budgetCents", /预算|压到|压在|控制在|改成|调整为|花到/],
  ["useCases", /游戏|剪辑|视频|开发|编程|办公|直播|渲染|绘图|设计|AI|深度学习|用途/],
  ["appearance", /白色|黑色|海景房|侧透|玻璃|静音|安静|噪音|灯效|RGB|小型化|体积|外观|颜值/i],
  ["existingParts", /已有|保留|手里有|现有|不用配|不要配|不配/],
  ["constraints", /不要|优先|关注|注重|风道|显存|水冷|灯/i],
  ["region", /地区|大陆|国行|海外|香港|欧美/],
];

export function revisionTouchedFields(instruction: string): IntentField[] {
  return INTENT_FIELDS.filter((field) =>
    TOUCH_PATTERNS.some(([patternField, pattern]) => patternField === field && pattern.test(instruction)),
  );
}

function valueEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type RevisionMergeResult = {
  intent: StructuredIntent;
  changedFields: IntentField[];
  rejectedFields: IntentField[];
};

export function mergeRevisionIntent(input: {
  before: StructuredIntent;
  instruction: string;
  modelIntent: StructuredIntent;
}): RevisionMergeResult {
  const touched = new Set(revisionTouchedFields(input.instruction));
  const explicitBudgetYuan = parseBudgetRevision(input.instruction);
  const merged: StructuredIntent = { ...input.modelIntent };
  const changedFields: IntentField[] = [];
  const rejectedFields: IntentField[] = [];

  for (const field of INTENT_FIELDS) {
    const beforeValue = input.before[field];
    const modelValue = input.modelIntent[field];

    if (field === "budgetCents" && explicitBudgetYuan !== null) {
      const explicitCents = explicitBudgetYuan * 100;
      merged.budgetCents = explicitCents;
      if (beforeValue !== explicitCents) changedFields.push(field);
      if (!valueEquals(modelValue, explicitCents)) rejectedFields.push(field);
      continue;
    }

    if (valueEquals(modelValue, beforeValue)) continue;
    if (touched.has(field)) {
      changedFields.push(field);
      continue;
    }
    // 拒绝漂移：还原 before 值（逐字段显式赋值，联合键索引写入 TS 会收窄成 never）
    switch (field) {
      case "budgetCents":
        merged.budgetCents = input.before.budgetCents;
        break;
      case "useCases":
        merged.useCases = input.before.useCases;
        break;
      case "appearance":
        merged.appearance = input.before.appearance;
        break;
      case "existingParts":
        merged.existingParts = input.before.existingParts;
        break;
      case "constraints":
        merged.constraints = input.before.constraints;
        break;
      case "region":
        merged.region = input.before.region;
        break;
    }
    rejectedFields.push(field);
  }

  return { intent: merged, changedFields, rejectedFields };
}
