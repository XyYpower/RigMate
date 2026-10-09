import type { CompressedCandidateFact } from "@/application/agent/runtime-types";
import type { AgentClaim } from "@/contracts/agent";
import type { CandidateSummary } from "@/domain/catalog/ranking";

/**
 * 上下文压缩（v2 Phase 5 §8）。
 *
 * 纪律：只能压缩解释性文本（name / retrievalReasons / spec 明细）；
 * 候选 ID、类别、质量状态、缺失字段、价格状态是事实，压缩后必须原样存活。
 * 主张（claims）不压缩——它们本身就是最小事实单元。
 */

export function compressCandidateContext(candidates: readonly CandidateSummary[]): CompressedCandidateFact[] {
  return candidates.map((candidate) => ({
    canonicalId: candidate.canonicalId,
    category: candidate.category,
    qualityStatus: candidate.qualityStatus,
    missingFields: candidate.missingFields,
    priceCents: candidate.priceCents,
  }));
}

/** 压缩不变量（spike 硬门 4 的正式版）：逐字段核对事实存活 */
export function assertCompressionPreservedFacts(
  before: readonly CandidateSummary[],
  after: readonly CompressedCandidateFact[],
): void {
  if (before.length !== after.length) {
    throw new Error("上下文压缩丢失了候选条目");
  }
  for (const [index, candidate] of before.entries()) {
    const fact = after[index]!;
    if (
      fact.canonicalId !== candidate.canonicalId ||
      fact.category !== candidate.category ||
      fact.qualityStatus !== candidate.qualityStatus ||
      fact.missingFields !== candidate.missingFields ||
      fact.priceCents !== candidate.priceCents
    ) {
      throw new Error(`上下文压缩篡改了候选事实：${candidate.canonicalId}`);
    }
  }
}

/** 压缩后送入模型/日志的文本形态：事实以紧凑 JSON 呈现，解释文本不进入 */
export function renderCompressedContext(candidates: readonly CompressedCandidateFact[], claims: readonly AgentClaim[]): string {
  return JSON.stringify({ candidates, claims });
}
