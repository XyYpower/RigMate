import type {
  BuildItem,
  BuildItemCategory,
  Finding,
  FindingStatus,
} from "@/domain/build/types";

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
