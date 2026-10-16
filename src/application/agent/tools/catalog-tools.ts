import type { CandidateSummary, RankedCandidate, VerifiedPriceFact } from "@/domain/catalog/ranking";
import { buildCategoryCandidates } from "@/domain/catalog/ranking";
import type { StructuredIntent } from "@/contracts/design";
import type { BuildItemCategory } from "@/domain/build/types";

/**
 * 目录检索工具（只读，M2 分桶召回）：质量硬过滤 → 分桶（exact/alias/ranked/diversity）
 * → 动态 K（点名型号扩 20，默认 6）。硬约束不在此过滤——唯一候选不能被召回层滤掉，
 * 兼容性仍由方案层规则裁决。
 */
export function createSearchCatalogTool(input: {
  entries: readonly RankedCandidate[];
  priceByCanonicalId: Map<string, VerifiedPriceFact>;
}): (query: { category: BuildItemCategory; intent?: StructuredIntent; queries?: string[]; limit?: number }) => CandidateSummary[] {
  return ({ category, intent, queries }) => {
    const effectiveIntent: StructuredIntent =
      intent ?? { budgetCents: null, useCases: [], appearance: [], existingParts: [], constraints: [], region: "中国大陆" };
    return buildCategoryCandidates({
      entries: [...input.entries],
      category,
      intent: effectiveIntent,
      priceByCanonicalId: input.priceByCanonicalId,
      queries,
    }).candidates;
  };
}
