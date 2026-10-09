import type { CandidateSummary, RankedCandidate, VerifiedPriceFact } from "@/domain/catalog/ranking";
import { filterQualityCandidates, rankCandidates } from "@/domain/catalog/ranking";
import type { StructuredIntent } from "@/contracts/design";
import type { BuildItemCategory } from "@/domain/build/types";

/** 目录检索工具（只读）：质量硬过滤 → 排序 → 每类前 limit 条候选摘要 */
export function createSearchCatalogTool(input: {
  entries: readonly RankedCandidate[];
  priceByCanonicalId: Map<string, VerifiedPriceFact>;
}): (query: { category: BuildItemCategory; intent?: StructuredIntent; limit?: number }) => CandidateSummary[] {
  return ({ category, intent, limit = 8 }) => {
    const effectiveIntent: StructuredIntent =
      intent ?? { budgetCents: null, useCases: [], appearance: [], existingParts: [], constraints: [], region: "中国大陆" };
    return rankCandidates(
      filterQualityCandidates([...input.entries]).filter((candidate) => candidate.category === category),
      effectiveIntent,
      input.priceByCanonicalId,
    ).slice(0, limit);
  };
}
