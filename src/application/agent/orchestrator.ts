import { randomUUID } from "node:crypto";
import type { StructuredIntent } from "@/contracts/design";
import type { DesignProposal } from "@/contracts/design";
import type { BuildItemCategory } from "@/domain/build/types";
import type { RankedCandidate, VerifiedPriceFact } from "@/domain/catalog/ranking";
import { buildCandidatePool, type CandidateSummary } from "@/domain/catalog/ranking";
import { generateDesignProposal } from "@/domain/design/proposal";
import { AgentRunState } from "./run-state";
import { withModelFallback } from "./fallback";
import { validateProposalGrounding, downgradeUnverifiedPrices, type GroundingReport } from "./validator";
import { isDeadlineExceeded, type AgentAttempt, type AgentRuntimeEvent } from "./runtime-types";
import type { AgentClaim } from "@/contracts/agent";

/**
 * 方案生成编排器（v2 Phase 5 §8）。
 *
 * 把 design service 的生成过程接入可审计、可回退的 Runtime：
 * received → understanding → retrieved → composed → validated → answered，
 * 异常（池空/候选不足/回退/验证失败）以 anomaly 事件单独记录。
 * service 作为兼容 adapter 保留 DesignResult API 与 UX 文案；
 * 模型永远只能经守卫返回候选 ID，写路径只在 service 的落库函数里。
 */

export type RetrievalContext = {
  catalogSize: number;
  entries: RankedCandidate[];
  priceByCanonicalId: Map<string, VerifiedPriceFact>;
  pool: CandidateSummary[];
  missingCategories: BuildItemCategory[];
};

export type OrchestrationStatus = "ok" | "insufficient" | "empty_pool" | "blocked";

export type DesignGenerationOrchestration = {
  status: OrchestrationStatus;
  proposal: DesignProposal | null;
  missingCategories: BuildItemCategory[];
  runtimeEvents: readonly AgentRuntimeEvent[];
  claims: readonly AgentClaim[];
  attempts: readonly AgentAttempt[];
  /** 回退发生时的原因（模型路径失败 → 规则排序） */
  fallbackReason: string | null;
  usedModelPath: boolean;
  selectedCategoryCount: number;
  grounding: GroundingReport | null;
  catalogSize: number;
  poolSize: number;
};

export async function orchestrateDesignGeneration(input: {
  requestId: string;
  intent: StructuredIntent;
  attempt: AgentAttempt;
  categories: readonly BuildItemCategory[];
  retrieve: () => Omit<RetrievalContext, "pool" | "missingCategories"> & Partial<Pick<RetrievalContext, "pool" | "missingCategories">>;
  /** 守卫后的模型选择（返回 null/抛错 = 走规则回退） */
  tryModelSelection?: (pool: readonly CandidateSummary[]) => Promise<Partial<Record<BuildItemCategory, string>> | null>;
}): Promise<DesignGenerationOrchestration> {
  const runState = new AgentRunState(input.attempt.attemptId);
  const attempts = [input.attempt];
  runState.advance("目标已接收并通过安全筛查。");
  runState.advance("目标已结构化，开始检索质量门候选。");

  const retrieved = input.retrieve();
  const priceByCanonicalId = retrieved.priceByCanonicalId;
  const { pool, missingCategories } = buildCandidatePool(
    retrieved.entries,
    input.intent,
    input.categories,
    priceByCanonicalId,
  );
  runState.advance(
    `质量门后有效候选 ${pool.length} 条（目录 ${retrieved.catalogSize} 条）。`,
    {
      retrievalIds: pool.map((candidate) => candidate.canonicalId),
      toolCalls: [
        {
          tool: "searchCatalog",
          attemptId: input.attempt.attemptId,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          resultIds: pool.map((candidate) => candidate.canonicalId),
        },
      ],
    },
  );

  const base: DesignGenerationOrchestration = {
    status: "ok",
    proposal: null,
    missingCategories,
    runtimeEvents: runState.all(),
    claims: [],
    attempts,
    fallbackReason: null,
    usedModelPath: false,
    selectedCategoryCount: 0,
    grounding: null,
    catalogSize: retrieved.catalogSize,
    poolSize: pool.length,
  };

  if (pool.length === 0) {
    runState.anomaly("质量门后无任何候选，不能生成方案。", { errorCode: "EMPTY_CANDIDATE_POOL" });
    return { ...base, status: "empty_pool", runtimeEvents: runState.all() };
  }

  // composed：模型优先（守卫内），失败回退同一 CandidateSet 的规则排序
  let preferredIds: Partial<Record<BuildItemCategory, string>> | undefined;
  let fallbackReason: string | null = null;
  let usedModelPath = false;
  if (input.tryModelSelection && !isDeadlineExceeded(input.attempt)) {
    const outcome = await withModelFallback({
      attempt: input.attempt,
      model: async () => {
        const selected = await input.tryModelSelection!(pool);
        return selected && Object.keys(selected).length > 0 ? selected : null;
      },
      rule: () => null,
    });
    if (outcome.path === "model") {
      preferredIds = outcome.value ?? undefined;
      usedModelPath = true;
    } else {
      fallbackReason = outcome.reason;
      runState.anomaly(outcome.reason, {
        fallback: { reason: outcome.reason, from: input.attempt.model, to: "rule-engine" },
        errorCode: "MODEL_FALLBACK",
      });
    }
  } else if (input.tryModelSelection) {
    fallbackReason = "模型尝试已超过截止时间";
    runState.anomaly(fallbackReason, {
      fallback: { reason: fallbackReason, from: input.attempt.model, to: "rule-engine" },
      errorCode: "MODEL_DEADLINE",
    });
  }

  const generated = generateDesignProposal({
    requestId: input.requestId,
    intent: input.intent,
    candidates: pool,
    version: 1,
    preferredIds,
  });
  if (generated.status === "insufficient") {
    runState.anomaly(`候选不足：缺 ${generated.missingCategories.join("、")}。`, { errorCode: "INSUFFICIENT_CANDIDATES" });
    return {
      ...base,
      status: "insufficient",
      missingCategories: generated.missingCategories,
      fallbackReason,
      runtimeEvents: runState.all(),
    };
  }
  runState.advance(`已组合 ${generated.proposal.items.length} 个核心配件候选。`);

  // validated：grounding 验证 + 价格事实降级
  const grounding = validateProposalGrounding({
    proposal: generated.proposal,
    priceByCanonicalId,
    findings: generated.findings,
    attemptId: input.attempt.attemptId,
  });
  let proposal = generated.proposal;
  if (grounding.downgradedCategories.length > 0) {
    proposal = downgradeUnverifiedPrices(proposal, grounding.downgradedCategories);
    runState.anomaly(`价格主张缺少证据来源，已降级为 unknown：${grounding.downgradedCategories.join("、")}。`, {
      errorCode: "PRICE_CLAIM_DOWNGRADED",
    });
  }
  if (!grounding.ok) {
    runState.anomaly("方案存在无法降级的主张违规，阻止回答。", { errorCode: "GROUNDING_BLOCKED" });
    return {
      ...base,
      status: "blocked",
      proposal: null,
      fallbackReason,
      usedModelPath,
      selectedCategoryCount: Object.keys(preferredIds ?? {}).length,
      grounding,
      runtimeEvents: runState.all(),
    };
  }
  runState.advance(`兼容性与主张验证完成（${generated.proposal.compatibility.message}）。`, {
    retrievalIds: pool.map((candidate) => candidate.canonicalId),
  });
  runState.advance("方案已就绪。");

  return {
    ...base,
    status: "ok",
    proposal,
    claims: grounding.claims,
    fallbackReason,
    usedModelPath,
    selectedCategoryCount: Object.keys(preferredIds ?? {}).length,
    grounding,
    runtimeEvents: runState.all(),
  };
}

/** 尝试构造：promptVersion 来自 prompts/registry，deadline 由调用方策略决定 */
export function createAgentAttempt(input: { model: string; promptVersion: string; deadlineMs: number }): AgentAttempt {
  return {
    attemptId: `attempt-${randomUUID()}`,
    promptVersion: input.promptVersion,
    model: input.model,
    deadlineAt: new Date(Date.now() + input.deadlineMs).toISOString(),
  };
}
