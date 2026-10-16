import type { StructuredIntent } from "@/contracts/design";
import type { BuildItemCategory } from "@/domain/build/types";
import { requiredFieldsOf } from "./quality";
import type { PublishStatus } from "./quality";
import { aliasMatchBlockedByVariantTail, modelPhrases, normalizeModelText } from "./normalize";
import { decisionSpecsOf } from "./decision-specs";

/**
 * 目录候选检索与排序（内核恢复计划 Task B；M2 分桶召回）。
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
  /** 中文展示名（可选，展示层数据；只参与召回匹配，不参与规格） */
  nameZh?: string | null;
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
  /** M2 分桶标注：exact/alias = 用户点名型号；ranked = 规则排序入选；diversity = 档位补召回 */
  bucket?: CandidateBucket;
  /** decisionSpecs 白名单投影（blueprint §6.2）：模型可见的决策字段子集，提示词一律用它替代裸 spec */
  decisionSpecs?: Record<string, unknown>;
};

/** 候选摘要可携带的来源等级：sourceIds 由应用层按证据链回填，领域层保持纯函数 */

/** 候选名称必须能作为方案项/配件标签（≤160，与 build_items.label 上限一致）；超长名称 = 导入脏数据，不进候选空间 */
export const MAX_CANDIDATE_NAME_LENGTH = 160;

function isCandidateNameUsable(name: unknown): boolean {
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= MAX_CANDIDATE_NAME_LENGTH;
}

/** 质量硬过滤：verified/supported 之外一律不进候选空间；超长名称条目一并排除 */
export function filterQualityCandidates<T extends { qualityStatus: PublishStatus }>(entries: T[]): T[] {
  return entries.filter(
    (entry) =>
      (entry.qualityStatus === "verified" || entry.qualityStatus === "supported") &&
      isCandidateNameUsable((entry as { name?: unknown }).name),
  );
}

function missingFieldsOf(candidate: RankedCandidate): string[] {
  const required = requiredFieldsOf(candidate.category);
  return required.filter((field) => candidate.spec[field] === undefined || candidate.spec[field] === null);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 单类别候选排序。得分为显式加总的线性分（便于测试与解释）：
 *   完整度（0–40）+ 预算（超支 −30 / 预算内 +20）+ 外观（10）+ 约束（5）+ 价格新鲜度（5）
 *   + 性能分归一化（0–10，来自数据集 perf_score 定序权威）
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
  // perf_score 归一化基准：类目内最大值（数据集口径：定序用，非跑分原值）
  const maxPerf = Math.max(
    0,
    ...candidates.map((candidate) => {
      const value = candidate.spec["perfScore"];
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    }),
  );
  const perfBonusOf = (candidate: RankedCandidate): number => {
    const value = candidate.spec["perfScore"];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || maxPerf === 0) return 0;
    return Math.round((value / maxPerf) * 10);
  };

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

      const perfBonus = perfBonusOf(candidate);
      if (perfBonus > 0) {
        score += perfBonus;
        const tier = candidate.spec["tier"];
        reasons.push(`性能分 ${candidate.spec["perfScore"]}${typeof tier === "number" ? ` · 档位 ${tier}/10` : ""}（相对定序）`);
      }

      return {
        canonicalId: candidate.id,
        category: candidate.category,
        name: candidate.name,
        spec: candidate.spec,
        decisionSpecs: decisionSpecsOf(candidate.category, candidate.spec),
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

/** 每类别保留的候选数（模型动态组合的工作集；规则式只消费第一名）。
 *  提升到 12：候选池扩容后给模型更大的组合空间，96 条摘要约 8-10k tokens 可控。 */
export const CANDIDATES_PER_CATEGORY = 12;

// ---- M2 分桶召回（launch-readiness §6 / blueprint §6.1 §6.3）----

export type CandidateBucket = "exact" | "alias" | "ranked" | "diversity";

export type CategoryRecallStats = {
  category: BuildItemCategory;
  /** 质量门内条目数（含因超长名称被排除的） */
  considered: number;
  /** 最终进入候选池的数量 */
  pooled: number;
  /** 因质量门外（partial 等）被拒的数量 */
  rejectedByQuality: number;
  /** 质量门内但名称超长被拒的数量 */
  rejectedByNameLength: number;
};

/** 默认每类候选数（blueprint §5.4）；用户点名型号时扩到 RECALL_EXACT_K */
export const RECALL_DEFAULT_K = 6;
export const RECALL_EXACT_K = 20;
/** 多样性补召回上限：主池之外补不同性能档，避免候选全是同一档 */
export const RECALL_DIVERSITY_K = 2;

/**
 * 单类别分桶召回：
 * - exact：型号短语与 name/nameZh/别名规范化后**全等**（用户就打了型号本身）；
 * - alias：短语**包含**别名或中文名（"换成 4070S"、"就用小雕显卡"）；
 * - ranked：现有规则排序补满主池；用户点名型号（exact/alias 非空）时 K 扩到 20；
 * - diversity：主池之外补不同性能档 ≤2 条。
 * 硬约束不在此过滤（唯一候选不能被召回层滤掉），仍由方案层规则裁决。
 */
export function buildCategoryCandidates(input: {
  entries: RankedCandidate[];
  category: BuildItemCategory;
  intent: StructuredIntent;
  priceByCanonicalId?: Map<string, VerifiedPriceFact>;
  now?: string;
  /** 用户语句（原始目标/修订指令/已有部件）——内部抽取型号短语；空 = 不激活 exact/alias 桶 */
  queries?: string[];
}): { candidates: CandidateSummary[]; stats: CategoryRecallStats } {
  const inCategory = input.entries.filter((candidate) => candidate.category === input.category);
  const qualityPassed = inCategory.filter(
    (candidate) => candidate.qualityStatus === "verified" || candidate.qualityStatus === "supported",
  );
  const rejectedByQuality = inCategory.length - qualityPassed.length;
  const usable = qualityPassed.filter((candidate) => isCandidateNameUsable(candidate.name));
  const rejectedByNameLength = qualityPassed.length - usable.length;
  const stats: CategoryRecallStats = {
    category: input.category,
    considered: qualityPassed.length,
    pooled: 0,
    rejectedByQuality,
    rejectedByNameLength,
  };

  const phraseNorms = (input.queries ?? []).flatMap((query) => modelPhrases(query)).map(normalizeModelText);
  // 中文俗称没有字母+数字，不形成型号短语：中文名/中文别名匹配在整句规范化文本上进行
  const queryNorms = (input.queries ?? []).map(normalizeModelText);
  const exactIds = new Set<string>();
  const namedIds = new Set<string>();
  if (phraseNorms.length > 0 || queryNorms.length > 0) {
    for (const candidate of usable) {
      const nameNorm = normalizeModelText(candidate.name);
      const nameZhNorm = candidate.nameZh ? normalizeModelText(candidate.nameZh) : "";
      const aliasNorms = candidate.aliases.map(normalizeModelText).filter((alias) => alias.length >= 2);
      const identityParts = [nameNorm, ...(nameZhNorm ? [nameZhNorm] : []), ...aliasNorms];
      // exact：全等，或查询是型号全名的子串（前缀命中，launch-readiness §6.1；len≥4 防短查询误触发）
      const exactHit =
        phraseNorms.some((phrase) => identityParts.some((part) => part === phrase || (phrase.length >= 4 && part.includes(phrase)))) ||
        queryNorms.some((query) => identityParts.some((part) => part === query));
      if (exactHit) {
        exactIds.add(candidate.id);
        namedIds.add(candidate.id);
        continue;
      }
      // alias：别名/中文名包含于查询（"换成 4070S""就想用七彩虹巡洋舰"）；
      // 命中点尾部是变体 token（5090 Ti≠5090）时拒绝——M3 型号变体消歧
      const containsAlias = (alias: string, text: string): boolean =>
        text.includes(alias) && !aliasMatchBlockedByVariantTail(alias, text);
      const aliasHit =
        aliasNorms.some(
          (alias) => phraseNorms.some((phrase) => containsAlias(alias, phrase)) || queryNorms.some((query) => containsAlias(alias, query)),
        ) ||
        (nameZhNorm.length >= 2 && queryNorms.some((query) => query.includes(nameZhNorm)));
      if (aliasHit) {
        namedIds.add(candidate.id);
      }
    }
  }

  const ranked: CandidateSummary[] = rankCandidates(usable, input.intent, input.priceByCanonicalId, input.now).map(
    (summary): CandidateSummary => ({
      ...summary,
      bucket: exactIds.has(summary.canonicalId)
        ? "exact"
        : namedIds.has(summary.canonicalId)
          ? "alias"
          : "ranked",
    }),
  );

  // 桶序：exact → alias → ranked；桶内保持规则排序
  const named = ranked.filter((candidate) => candidate.bucket !== "ranked");
  const rest = ranked.filter((candidate) => candidate.bucket === "ranked");
  const k = namedIds.size > 0 ? RECALL_EXACT_K : RECALL_DEFAULT_K;
  const pooledList = [...named, ...rest].slice(0, k);

  // diversity：主池之外补未出现过的性能档 ≤2
  const pooledIds = new Set(pooledList.map((candidate) => candidate.canonicalId));
  const seenTiers = new Set(
    pooledList.map((candidate) => candidate.spec["tier"]).filter((tier): tier is number => typeof tier === "number"),
  );
  const diversity: typeof pooledList = [];
  for (const candidate of rest) {
    if (diversity.length >= RECALL_DIVERSITY_K) break;
    if (pooledIds.has(candidate.canonicalId)) continue;
    const tier = candidate.spec["tier"];
    if (typeof tier === "number" && !seenTiers.has(tier)) {
      seenTiers.add(tier);
      diversity.push({ ...candidate, bucket: "diversity" });
    }
  }

  const candidates = [...pooledList, ...diversity];
  stats.pooled = candidates.length;
  return { candidates, stats };
}

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
