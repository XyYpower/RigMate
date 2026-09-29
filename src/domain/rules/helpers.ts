import type {
  BuildItem,
  BuildItemCategory,
  Finding,
  FindingStatus,
} from "@/domain/build/types";
import { isRuleUsable, type FieldQualityStatus } from "@/domain/catalog/quality";

export function itemsOf<C extends BuildItemCategory>(
  items: BuildItem[],
  category: C,
): Extract<BuildItem, { category: C }>[] {
  return items.filter((item): item is Extract<BuildItem, { category: C }> => item.category === category);
}

export function firstOf<C extends BuildItemCategory>(
  items: BuildItem[],
  category: C,
): Extract<BuildItem, { category: C }> | undefined {
  return itemsOf(items, category)[0];
}

export function normalizeSpecValue(value: string): string {
  return value.trim().toUpperCase();
}

export function makeFinding(input: {
  ruleId: string;
  status: FindingStatus;
  itemIds: string[];
  conclusion: string;
  evidence: string[];
  assumptions?: string[];
  suggestedAction: string;
}): Finding {
  return {
    ruleId: input.ruleId,
    status: input.status,
    itemIds: input.itemIds,
    conclusion: input.conclusion,
    evidence: input.evidence,
    dataDate: null,
    confidence: input.status === "block" ? "high" : input.status === "warn" ? "medium" : "high",
    assumptions: input.assumptions ?? [],
    missingFields: [],
    suggestedAction: input.suggestedAction,
  };
}

export function unknownFinding(
  ruleId: string,
  itemIds: string[],
  missingFields: string[],
): Finding {
  return {
    ruleId,
    status: "unknown",
    itemIds,
    conclusion: "暂时无法判断，缺少关键规格信息。",
    evidence: ["相关条目已存在，但缺少下列字段，系统不会用常见值代替事实。"],
    dataDate: null,
    confidence: "low",
    assumptions: ["没有根据品牌、系列或常见搭配推断缺失字段。"],
    missingFields,
    suggestedAction: `补充并确认：${missingFields.join("、")}。`,
  };
}

// ---- 字段质量门（实施计划 Task 5：unknown/conflicting/stale 一律不得 pass）----

const QUALITY_STATUS_LABELS: Record<FieldQualityStatus, string> = {
  verified: "已核验",
  supported: "有参考资料",
  partial: "部分可参考",
  conflicting: "来源冲突",
  stale: "来源过期",
  unknown: "无来源证据",
  rejected: "证据被驳回",
};

const QUALITY_BLOCK_REASONS: Partial<Record<FieldQualityStatus, string>> = {
  conflicting: "来源值冲突，需人工复核",
  stale: "证据已过期，需重新复核来源",
  rejected: "证据被驳回，不可信",
  unknown: "无来源证据",
  partial: "证据不足以支撑结论",
};

export type QualityGatedField = {
  item: BuildItem;
  /** spec 字段名（如 "lengthMm"） */
  field: string;
  /** 面向用户的字段名（如 "显卡长度"） */
  label: string;
};

/**
 * 质量门：字段已填值但质量状态不可用于规则（仅 verified/supported 可通过）时，
 * 返回带来源状态与原因的 unknown Finding；全部字段可用（或未附加质量层）返回 null。
 * 未附加 fieldQuality 的条目行为与历史版本完全一致（向后兼容）。
 */
export function gateFieldQuality(
  ruleId: string,
  itemIds: string[],
  fields: QualityGatedField[],
): Finding | null {
  const blocked = fields
    .map(({ item, field, label }) => ({
      label,
      status: item.fieldQuality?.[field],
      hasValue: (item.spec as Record<string, unknown>)[field] !== undefined && (item.spec as Record<string, unknown>)[field] !== null,
    }))
    .filter(
      (entry): entry is { label: string; status: FieldQualityStatus; hasValue: boolean } =>
        entry.hasValue && entry.status !== undefined && !isRuleUsable(entry.status),
    );
  if (blocked.length === 0) return null;
  return {
    ruleId,
    status: "unknown",
    itemIds,
    conclusion: `关键规格的质量状态未通过核验，不能判定通过：${blocked.map((entry) => entry.label).join("、")}。`,
    evidence: blocked.map(
      (entry) =>
        `${entry.label}：质量状态「${QUALITY_STATUS_LABELS[entry.status]}」——${QUALITY_BLOCK_REASONS[entry.status] ?? "未通过核验"}，不用于通过结论。`,
    ),
    dataDate: null,
    confidence: "low",
    assumptions: ["质量状态不可用的字段一律按资料不足处理，不用常见值代替事实。"],
    missingFields: blocked.map((entry) => entry.label),
    suggestedAction: `复核来源或补充证据：${blocked.map((entry) => entry.label).join("、")}。`,
  };
}
