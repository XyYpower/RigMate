import type { StructuredIntent } from "@/contracts/design";
import type { BuildItemCategory } from "@/domain/build/types";
import { requiredFieldsOf } from "./quality";
import type { PublishStatus } from "./quality";

/**
 * 目录候选检索与排序（内核恢复计划 Task B）。
 *
 * 原则：
 * - 质量门是硬过滤：只有 verified / supported 产品能成为候选，partial/conflicting/stale/rejected/merged 一律排除；
 * - 排序是可测量的规范化线性得分：必填字段完整度 > 预算距离 > 用途/外观匹配 > 已有硬件约束 > 价格证据新鲜度；
 * - 候选摘要带 retrievalReasons——每个候选为什么排在这里，必须可解释；
 * - 没有 verified 价格时预算距离按中性处理，不猜价格。
 */

/** 候选输入形态（loadSourcedCatalog 的行 + 价格上下文可选注入） */
export type RankedCandidate = {
  id: string;
  category: BuildItemCategory;
  name: string;
  aliases: string[];
  spec: Record<string, unknown>;
  qualityStatus: PublishStatus;
};

/** 已审核价格事实（Task C：只有 review_status=verified 的价格进入排序与方案） */
export type VerifiedPriceFact = {
  canonicalProductId: string;
  priceCents: number;
  /** 证据行 id（price_evidence.id），随候选摘要透出以便回溯 */
  evidenceIds: string[];
  capturedAt: string;
};

/** 面向模型与日志的候选摘要（Task D：模型只允许看到这个形态） */
export type CandidateSummary = {
  canonicalId: string;
  category: BuildItemCategory;
  name: string;
  spec: Record<string, unknown>;
  qualityStatus: "verified" | "supported";
  sourceIds: string[];
  missingFields: string[];
  priceCents: number | null;
  retrievalReasons: string[];
};

/** 候选摘要可携带的来源等级：sourceIds 由应用层按证据链回填，领域层保持纯函数 */

/** 质量硬过滤：verified/supported 之外一律不进候选空间 */
export function filterQualityCandidates<T extends { qualityStatus: PublishStatus }>(entries: T[]): T[] {
  return entries.filter((entry) => entry.qualityStatus === "verified" || entry.qualityStatus === "supported");
}

function missingFieldsOf(candidate: RankedCandidate): string[] {
  const required = requiredFieldsOf(candidate.category);
  return required.filter((field) => candidate.spec[field] === undefined || candidate.spec[field] === null);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 单类别候选排序。得分为显式加总的线性分（便于测试与解释）：
 *   完整度（0–40）+ 预算（超支 −30 / 预算内 +20）+ 外观（10）+ 约束（5）+ 价格新鲜度（5）
 * 同分时预算内价格更高者靠前（同等条件下选更高档），价格缺失者排在其后。
 * 排序只决定顺序；能不能进方案仍由质量门与上层选择逻辑决定。
 */
export function rankCandidates(
  candidates: RankedCandidate[],
  intent: StructuredIntent,
  priceByCanonicalId: Map<string, VerifiedPriceFact> = new Map(),
  now: string = new Date().toISOString(),
): CandidateSummary[] {
  const appearanceTerms = intent.appearance.map((term) => term.trim().toLowerCase()).filter(Boolean);
  const constraintTerms = intent.constraints.map((term) => term.trim().toLowerCase()).filter(Boolean);

  return candidates
    .map((candidate) => {
      const missing = missingFieldsOf(candidate);
      const required = requiredFieldsOf(candidate.category);
      const completeness = required.length > 0 ? (required.length - missing.length) / required.length : 1;
      const price = priceByCanonicalId.get(candidate.id) ?? null;
      const reasons: string[] = [];
      let score = 0;

      score += completeness * 40;
      reasons.push(
        missing.length === 0
          ? `必填字段 ${required.length}/${required.length} 完整`
          : `必填字段缺 ${missing.join("、")}`,
      );

      if (price !== null && intent.budgetCents !== null) {
        if (price.priceCents <= intent.budgetCents) {
          score += 20;
          reasons.push(`已审核价格 ¥${(price.priceCents / 100).toLocaleString("zh-CN")} 在预算内`);
        } else {
          score -= 30;
          reasons.push(`已审核价格 ¥${(price.priceCents / 100).toLocaleString("zh-CN")} 超出预算`);
        }
      } else if (price !== null) {
        reasons.push(`已有已审核价格 ¥${(price.priceCents / 100).toLocaleString("zh-CN")}（未设预算，不参与预算排序）`);
      } else if (intent.budgetCents !== null) {
        reasons.push("暂无已审核价格，预算匹配无法参与排序");
      }

      const ageDays = price ? (Date.parse(now) - Date.parse(price.capturedAt)) / DAY_MS : null;
      if (ageDays !== null && Number.isFinite(ageDays) && ageDays <= 90) {
        score += 5;
        reasons.push("价格证据在 90 天内");
      }

      const haystack = [candidate.name, ...candidate.aliases].join(" ").toLowerCase();
      const appearanceHit = appearanceTerms.find((term) => haystack.includes(term));
      if (appearanceHit) {
        score += 10;
        reasons.push(`命中外观偏好：${appearanceHit}`);
      }
      const constraintHit = constraintTerms.find((term) => haystack.includes(term));
      if (constraintHit) {
        score += 5;
        reasons.push(`命中约束：${constraintHit}`);
      }

      return {
        canonicalId: candidate.id,
        category: candidate.category,
        name: candidate.name,
        spec: candidate.spec,
        qualityStatus: candidate.qualityStatus as "verified" | "supported",
        sourceIds: [] as string[],
        missingFields: missing,
        priceCents: price?.priceCents ?? null,
        retrievalReasons: reasons,
        __score: score,
      };
    })
    .sort(
      (a, b) =>
        b.__score - a.__score ||
        (b.priceCents ?? -1) - (a.priceCents ?? -1) ||
        a.canonicalId.localeCompare(b.canonicalId),
    )
    .map((scored) => {
      const { __score, ...summary } = scored;
      void __score;
      return summary;
    });
}

/** 每类别保留的候选数（模型候选池上限；规则式只消费第一名） */
export const CANDIDATES_PER_CATEGORY = 8;

/** 组装候选池：质量硬过滤 → 按类别排序 → 每类取前 N；附带无候选类别的缺失清单。
 *  已有硬件的类别排除发生在方案生成层（候选池保持完整，模型可见全局）。 */
export function buildCandidatePool(
  entries: RankedCandidate[],
  intent: StructuredIntent,
  allCategories: readonly BuildItemCategory[],
  priceByCanonicalId: Map<string, VerifiedPriceFact> = new Map(),
  now: string = new Date().toISOString(),
): { pool: CandidateSummary[]; missingCategories: BuildItemCategory[] } {
  const qualityFiltered = filterQualityCandidates(entries);
  const pool: CandidateSummary[] = [];
  const missingCategories: BuildItemCategory[] = [];
  for (const category of allCategories) {
    const ranked = rankCandidates(
      qualityFiltered.filter((candidate) => candidate.category === category),
      intent,
      priceByCanonicalId,
      now,
    ).slice(0, CANDIDATES_PER_CATEGORY);
    if (ranked.length === 0) missingCategories.push(category);
    pool.push(...ranked);
  }
  return { pool, missingCategories };
}
