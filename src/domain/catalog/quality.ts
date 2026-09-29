import { z } from "zod";
import { specSchemaByCategory } from "../build/specs";
import type { BuildItemCategory } from "../build/types";
import { REQUIRED_FIELDS_BY_CATEGORY } from "./audit";

/**
 * 目录数据质量纯函数（docs/DATA_PROVENANCE_AND_QUALITY.md §3/§6/§7、DATA_OPERATIONS_PLAYBOOK.md §8）
 *
 * 核心纪律：
 * - 字段质量按「来源等级 × 身份匹配 × 新鲜度 × 一致性」四维独立判定，不存在"整行可信"；
 * - verified 只留给 S1/S2 来源、身份明确、经人工复核且无未解决冲突的证据；
 * - conflicting / stale / unknown / rejected 字段在规则引擎中只能得到 unknown 结论，不得输出 pass；
 * - S0（用户口述）/ S5（模型经验）不构成规格事实，永不参与字段判定；
 * - series 只作身份语境，绝不单独用于身份判定（不用芯片系列替代板卡型号）。
 */

// ---- 枚举 ----

/** 来源等级（PROVENANCE §3，S0–S5） */
export const sourceTierSchema = z.enum(["S0", "S1", "S2", "S3", "S4", "S5"]);
export type SourceTier = z.infer<typeof sourceTierSchema>;

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  S0: "用户明确输入",
  S1: "厂商一手资料",
  S2: "授权结构化来源",
  S3: "专业第三方资料",
  S4: "用户提交与人工录入",
  S5: "模型经验",
};

/** 字段级质量状态（PROVENANCE §6） */
export const fieldQualityStatusSchema = z.enum([
  "verified",
  "supported",
  "partial",
  "conflicting",
  "stale",
  "unknown",
  "rejected",
]);
export type FieldQualityStatus = z.infer<typeof fieldQualityStatusSchema>;

/** 产品级发布状态（PLAYBOOK §8；比字段级少 unknown——无任何已判定字段时按 partial 处理） */
export const publishStatusSchema = z.enum([
  "verified",
  "supported",
  "partial",
  "conflicting",
  "stale",
  "rejected",
]);
export type PublishStatus = z.infer<typeof publishStatusSchema>;

/** 来源/证据行的审核状态（PROVENANCE product_sources.status） */
export const evidenceStatusSchema = z.enum(["unreviewed", "verified", "conflicting", "stale", "rejected"]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

/** 身份匹配：MPN 精确 / 无 MPN 时品牌+完整型号+变体至少两项匹配 / 未匹配 */
export const identityMatchSchema = z.enum(["mpn_exact", "fields_matched", "unmatched"]);
export type IdentityMatch = z.infer<typeof identityMatchSchema>;

// ---- 产品身份（ACQUISITION §6）----

export const productIdentitySchema = z.object({
  manufacturer: z.string().trim().max(80).nullable(),
  series: z.string().trim().max(80).nullable(),
  model: z.string().trim().max(160).nullable(),
  variant: z.string().trim().max(160).nullable(),
  mpn: z.string().trim().max(80).nullable(),
});
export type ProductIdentity = z.infer<typeof productIdentitySchema>;

function normalizeIdentityPart(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

/**
 * 两份身份记录的匹配判定。
 * - 双方都有 MPN：MPN 归一后相等 → mpn_exact，不等 → unmatched（MPN 是身份锚点，相斥即不同变体）；
 * - 无 MPN：变体字段双方都有且不同 → unmatched（显式变体相斥优先于任何"两项匹配"）；
 * - 其余按 品牌/完整型号/变体 三项计分（series 不计分，只作语境），≥2 项 → fields_matched。
 */
export function identityMatchOf(a: ProductIdentity, b: ProductIdentity): IdentityMatch {
  const mpnA = normalizeIdentityPart(a.mpn);
  const mpnB = normalizeIdentityPart(b.mpn);
  if (mpnA && mpnB) return mpnA === mpnB ? "mpn_exact" : "unmatched";

  const variantA = normalizeIdentityPart(a.variant);
  const variantB = normalizeIdentityPart(b.variant);
  if (variantA && variantB && variantA !== variantB) return "unmatched";

  const makerA = normalizeIdentityPart(a.manufacturer);
  const makerB = normalizeIdentityPart(b.manufacturer);
  const modelA = normalizeIdentityPart(a.model);
  const modelB = normalizeIdentityPart(b.model);

  let score = 0;
  if (makerA && makerB && makerA === makerB) score += 1;
  if (modelA && modelB && modelA === modelB) score += 1;
  if (variantA && variantB && variantA === variantB) score += 1;
  return score >= 2 ? "fields_matched" : "unmatched";
}

// ---- 字段值 schema 校验（错误单位防线）----

/** 字段值必须通过该类别的 spec schema（正整数毫米、枚举接口等），单位/类型错误直接判非法 */
export function isValidSpecFieldValue(category: BuildItemCategory, field: string, value: unknown): boolean {
  const shape = specSchemaByCategory[category].shape as Record<string, z.ZodType>;
  const fieldSchema = shape[field];
  if (!fieldSchema) return false;
  return fieldSchema.safeParse(value).success;
}

// ---- 字段质量计算 ----

/** 进入质量计算的证据事实（存储行经仓储映射后的最小形态） */
export type FieldEvidenceFact = {
  id: string;
  value: unknown;
  tier: SourceTier;
  identityMatch: IdentityMatch;
  status: EvidenceStatus;
  /** 抓取/录入时间（ISO） */
  capturedAt: string;
  /** 本条证据取代的旧证据 id（目标不存在于列表中时视为无取代关系） */
  supersedesId: string | null;
};

export type FieldQualityResult = {
  status: FieldQualityStatus;
  /** 判定采用的字段值；无可采用值时为 undefined */
  value: unknown;
  usedEvidenceIds: string[];
  /** none 无冲突 / resolved 已按更高等级来源裁定（冲突事件仍需保留）/ unresolved 未能裁定 */
  conflict: "none" | "resolved" | "unresolved";
  /** 面向 UI 与规则 Finding 的一句话原因 */
  reason: string;
  excluded: Array<{ id: string; reason: "rejected" | "stale" | "not_a_fact" | "invalid_value" | "identity_unclear" }>;
};

export type ComputeFieldQualityOptions = {
  /** 计算时刻（ISO）；传入后才启用按天数的过期判定 */
  now?: string;
  /** 新鲜度窗口（天）。规格字段默认不自动过期；季度复核场景可传 90 */
  staleAfterDays?: number;
};

const TIER_RANK: Record<SourceTier, number> = { S1: 4, S2: 3, S3: 2, S4: 1, S0: 0, S5: 0 };
const DAY_MS = 24 * 60 * 60 * 1000;

function isStaleFact(fact: FieldEvidenceFact, options: ComputeFieldQualityOptions): boolean {
  if (fact.status === "stale") return true;
  if (!options.staleAfterDays || !options.now) return false;
  const capturedMs = Date.parse(fact.capturedAt);
  if (Number.isNaN(capturedMs)) return false;
  return Date.parse(options.now) - capturedMs > options.staleAfterDays * DAY_MS;
}

function normalizeValueKey(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.trim().toLocaleLowerCase().replace(/\s+/g, " "));
  return JSON.stringify(value);
}

function bestOfGroup(group: FieldEvidenceFact[]): FieldEvidenceFact {
  return [...group].sort((a, b) => {
    const byRank = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (byRank !== 0) return byRank;
    // 同级时人工已复核者优先，其次取较新者
    const byReview = (b.status === "verified" ? 1 : 0) - (a.status === "verified" ? 1 : 0);
    if (byReview !== 0) return byReview;
    return Date.parse(b.capturedAt) - Date.parse(a.capturedAt);
  })[0];
}

/**
 * 单字段质量判定。
 *
 * 排除序：被取代 → rejected → stale → S0/S5 → 单位/类型非法；排除后按剩余原因取最严重者定级。
 * 候选冲突：全部候选值归一后一致 → 无冲突；不一致时仅当「最高等级组严格高于次高组」且候选身份可用
 * （至少一条 identityMatch 非 unmatched）才按高等级来源裁定（resolved，状态封顶 supported）；
 * 同级冲突或身份不明 → unresolved → conflicting，禁止用于通过结论。
 * 无冲突：verified 仅当最高证据为 S1/S2、身份可用、且该证据行已人工复核（status === "verified"）；
 * 身份全部未匹配 → 变体不明确，封顶 supported（有参考资料）。
 */
export function computeFieldQuality(
  category: BuildItemCategory,
  field: string,
  evidences: FieldEvidenceFact[],
  options: ComputeFieldQualityOptions = {},
): FieldQualityResult {
  if (evidences.length === 0) {
    return { status: "unknown", value: undefined, usedEvidenceIds: [], conflict: "none", reason: "该字段暂无任何来源证据", excluded: [] };
  }

  const knownIds = new Set(evidences.map((evidence) => evidence.id));
  const supersededIds = new Set(
    evidences
      .map((evidence) => evidence.supersedesId)
      .filter((targetId): targetId is string => targetId !== null && knownIds.has(targetId)),
  );
  const active = evidences.filter((evidence) => !supersededIds.has(evidence.id));

  const excluded: FieldQualityResult["excluded"] = [];
  const candidates: FieldEvidenceFact[] = [];
  for (const fact of active) {
    if (fact.status === "rejected") {
      excluded.push({ id: fact.id, reason: "rejected" });
    } else if (isStaleFact(fact, options)) {
      excluded.push({ id: fact.id, reason: "stale" });
    } else if (fact.tier === "S0" || fact.tier === "S5") {
      excluded.push({ id: fact.id, reason: "not_a_fact" });
    } else if (!isValidSpecFieldValue(category, field, fact.value)) {
      excluded.push({ id: fact.id, reason: "invalid_value" });
    } else {
      candidates.push(fact);
    }
  }

  if (candidates.length === 0) {
    const reasons = excluded.map((item) => item.reason);
    const base = { value: undefined, usedEvidenceIds: [], conflict: "none" as const, excluded };
    if (reasons.includes("rejected")) {
      return { ...base, status: "rejected", reason: "该字段的证据均被驳回，不可用于判断" };
    }
    if (reasons.includes("stale")) {
      return { ...base, status: "stale", reason: "证据已过期，需要重新复核来源" };
    }
    if (reasons.includes("invalid_value")) {
      return { ...base, status: "unknown", reason: "证据值不符合字段 schema（单位或类型错误）" };
    }
    return { ...base, status: "unknown", reason: "只有用户口述或模型经验，不构成规格事实" };
  }

  const matched = candidates.filter((fact) => fact.identityMatch !== "unmatched");
  const identityUnclear = matched.length === 0;
  const pool = identityUnclear ? candidates : matched;
  if (!identityUnclear) {
    // 存在身份可用证据时，未匹配证据只作参考——它们可能属于兄弟变体，不参与取值也不制造冲突
    for (const fact of candidates) {
      if (fact.identityMatch === "unmatched") excluded.push({ id: fact.id, reason: "identity_unclear" });
    }
  }

  const groups = new Map<string, FieldEvidenceFact[]>();
  for (const fact of pool) {
    const key = normalizeValueKey(fact.value);
    const group = groups.get(key);
    if (group) group.push(fact);
    else groups.set(key, [fact]);
  }
  const sortedGroups = [...groups.values()].sort(
    (a, b) => Math.max(...b.map((fact) => TIER_RANK[fact.tier])) - Math.max(...a.map((fact) => TIER_RANK[fact.tier])),
  );

  if (sortedGroups.length > 1) {
    const topRank = Math.max(...sortedGroups[0].map((fact) => TIER_RANK[fact.tier]));
    const runnerUpRank = Math.max(...sortedGroups[1].map((fact) => TIER_RANK[fact.tier]));
    if (!identityUnclear && topRank > runnerUpRank) {
      const winners = sortedGroups[0];
      return {
        status: "supported",
        value: bestOfGroup(winners).value,
        usedEvidenceIds: winners.map((fact) => fact.id),
        conflict: "resolved",
        reason: `来源值冲突，已按更高等级来源（${SOURCE_TIER_LABELS[winners[0].tier]}）裁定，待人工复核`,
        excluded,
      };
    }
    return {
      status: "conflicting",
      value: undefined,
      usedEvidenceIds: sortedGroups.map((group) => bestOfGroup(group).id),
      conflict: "unresolved",
      reason: "来源值冲突，禁止用于通过结论，需人工复核",
      excluded,
    };
  }

  const group = sortedGroups[0];
  const best = bestOfGroup(group);
  if (identityUnclear) {
    return {
      status: "supported",
      value: best.value,
      usedEvidenceIds: [best.id],
      conflict: "none",
      reason: "证据未确认对应具体产品变体，仅供参考",
      excluded,
    };
  }
  if (best.tier === "S1" || best.tier === "S2") {
    if (best.status === "verified") {
      return {
        status: "verified",
        value: best.value,
        usedEvidenceIds: [best.id],
        conflict: "none",
        reason: best.tier === "S1" ? "厂商一手来源，已人工核验" : "授权结构化来源，已人工核验",
        excluded,
      };
    }
    return {
      status: "supported",
      value: best.value,
      usedEvidenceIds: [best.id],
      conflict: "none",
      reason: "来源等级足够，但证据尚未经人工复核",
      excluded,
    };
  }
  const tierLabel = SOURCE_TIER_LABELS[best.tier];
  return {
    status: "supported",
    value: best.value,
    usedEvidenceIds: [best.id],
    conflict: "none",
    reason: `${tierLabel}，非厂商一手，仅供参考`,
    excluded,
  };
}

// ---- 产品级状态与规则接入 ----

/** 产品级发布状态由必填字段的状态聚合：rejected > conflicting > stale > verified > supported > partial */
export function computeProductQualityStatus(fieldStatuses: Record<string, FieldQualityStatus>): PublishStatus {
  const statuses = Object.values(fieldStatuses);
  if (statuses.length === 0) return "partial";
  if (statuses.includes("rejected")) return "rejected";
  if (statuses.includes("conflicting")) return "conflicting";
  if (statuses.includes("stale")) return "stale";
  if (statuses.every((status) => status === "verified")) return "verified";
  if (statuses.every((status) => status === "verified" || status === "supported")) return "supported";
  return "partial";
}

/** 规则引擎只信 verified/supported；其余状态一律按 unknown 处理，不得输出 pass（PLAYBOOK §8） */
export function isRuleUsable(status: FieldQualityStatus): boolean {
  return status === "verified" || status === "supported";
}

/** 该类别参与质量聚合与规则判断的必填字段（单一事实源在 audit.ts） */
export function requiredFieldsOf(category: BuildItemCategory): string[] {
  return REQUIRED_FIELDS_BY_CATEGORY[category];
}
