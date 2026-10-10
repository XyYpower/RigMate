import { randomUUID } from "node:crypto";
import type { StructuredIntent } from "@/contracts/design";
import type { DesignProposal } from "@/contracts/design";
import type { BuildItemCategory } from "@/domain/build/types";
import type { RankedCandidate, VerifiedPriceFact } from "@/domain/catalog/ranking";
import type { CandidateSummary } from "@/domain/catalog/ranking";
import { generateDesignProposal } from "@/domain/design/proposal";
import { AgentRunState } from "./run-state";
import { withModelFallback } from "./fallback";
import { validateProposalGrounding, downgradeUnverifiedPrices, type GroundingReport } from "./validator";
import { isDeadlineExceeded, type AgentAttempt, type AgentRuntimeEvent } from "./runtime-types";
import type { AgentClaim } from "@/contracts/agent";
import type { AgentToolRegistry } from "./tool-contracts";
import { createAgentTools } from "./tools/registry";
import type { CandidateQualityContext } from "@/domain/design/proposal";

export type ModelSelection = {
  selectedIds: Partial<Record<BuildItemCategory, string>>;
  rationaleByCategory?: Partial<Record<BuildItemCategory, string>>;
};

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
  qualityByCanonicalId?: Map<string, CandidateQualityContext>;
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
  tryModelSelection?: (pool: readonly CandidateSummary[]) => Promise<ModelSelection | null>;
  /** 受限只读工具；未传入时由 Runtime 根据同一检索上下文装配 */
  tools?: AgentToolRegistry;
  /** 检查结果驱动的换件提案（有限迭代）：返回 null = 模型认为池内没有更优候选 */
  tryModelSwap?: (input: {
    findings: Array<{ ruleId: string; status: string; conclusion: string; suggestedAction: string }>;
    currentItem: { category: BuildItemCategory; label: string; spec: Record<string, unknown> };
    candidates: readonly CandidateSummary[];
  }) => Promise<{ category: BuildItemCategory; catalogId: string; reason: string } | null>;
}): Promise<DesignGenerationOrchestration> {
  const runState = new AgentRunState(input.attempt.attemptId);
  const attempts = [input.attempt];
  runState.advance("目标已接收并通过安全筛查。");
  runState.advance("目标已结构化，开始检索质量门候选。");
  let compatibilityToolRuleIds: string[] = [];

  try {
  const retrieved = input.retrieve();
  const priceByCanonicalId = retrieved.priceByCanonicalId;
  const tools = input.tools ?? createAgentTools({ entries: retrieved.entries, priceByCanonicalId });
  const pool: CandidateSummary[] = [];
  const missingCategories: BuildItemCategory[] = [];
  for (const category of input.categories) {
    const categoryPool = [...tools.searchCatalog({ category, intent: input.intent, limit: 8 })];
    if (categoryPool.length === 0) missingCategories.push(category);
    pool.push(...categoryPool);
  }
  const qualityByCanonicalId = new Map(retrieved.qualityByCanonicalId ?? []);
  const evidenceByCanonicalId = new Map<string, ReadonlyArray<{ fieldPath: string; status: import("@/domain/catalog/quality").FieldQualityStatus; sourceIds: string[] }>>();
  for (const candidate of pool) {
    const evidence = tools.searchEvidence({ canonicalProductId: candidate.canonicalId });
    evidenceByCanonicalId.set(candidate.canonicalId, evidence);
    if (!qualityByCanonicalId.has(candidate.canonicalId) && evidence.length > 0) {
      qualityByCanonicalId.set(candidate.canonicalId, {
        fieldQuality: Object.fromEntries(evidence.map((item) => [item.fieldPath.replace(/^spec\./, ""), item.status])),
        evidenceSourceIds: [...new Set(evidence.flatMap((item) => item.sourceIds))],
      });
    }
  }
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
        ...pool.map((candidate) => {
          const evidence = evidenceByCanonicalId.get(candidate.canonicalId) ?? [];
          return {
            tool: "searchEvidence",
            attemptId: input.attempt.attemptId,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            resultIds: evidence.flatMap((item) => item.sourceIds),
          };
        }),
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
  let rationaleByCategory: Partial<Record<BuildItemCategory, string>> | undefined;
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
      preferredIds = outcome.value?.selectedIds;
      rationaleByCategory = outcome.value?.rationaleByCategory;
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
    rationaleByCategory,
    qualityContextByCanonicalId: qualityByCanonicalId,
    compatibilityCheck: (items) => {
      const findings = tools.runCompatibilityCheck({
        items: items.map((item) => ({
          id: item.id,
          category: item.category,
          label: item.label,
          spec: item.spec,
          fieldQuality: item.fieldQuality,
        })),
      });
      compatibilityToolRuleIds = findings.map((finding) => finding.ruleId);
      return [...findings];
    },
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
  if (generated.status !== "ok") {
    runState.anomaly("生成器返回了未知状态。", { errorCode: "GENERATION_UNKNOWN" });
    return { ...base, status: "blocked", fallbackReason, runtimeEvents: runState.all() };
  }

  let proposal = generated.proposal;
  let findings = generated.findings;
  runState.advance(`已组合 ${proposal.items.length} 个核心配件候选。`);
  // 有限迭代（next-phase）：检查 → 模型换件 → 再检查，最多 2 轮。
  // 只有当换件确实减少阻断（或阻断持平且警告减少）时才采纳，否则保留原组合——
  // 模型不能让冲突或 unknown 变成通过，迭代也不能把方案越改越差。
  if (input.tryModelSwap && !isDeadlineExceeded(input.attempt)) {
    const MAX_SWAP_ITERATIONS = 2;
    for (let iteration = 1; iteration <= MAX_SWAP_ITERATIONS; iteration += 1) {
      const actionable = findings
        .filter((finding) => finding.status === "block" || finding.status === "warn")
        .sort((a, b) => (a.status === "block" ? -1 : 1) - (b.status === "block" ? -1 : 1));
      if (actionable.length === 0) break;

      // 规则可能同时点名冲突双方（如 CPU 与主板）；逐个被点名类别让模型判断，
      // 只考虑有替换候选的类别。模型对该类别认为无更优时返回 null，尝试下一个。
      const implicated: Array<{
        category: BuildItemCategory;
        currentItem: { category: BuildItemCategory; label: string; spec: Record<string, unknown> };
        candidates: CandidateSummary[];
      }> = [];
      for (const category of [
        ...new Set(
          actionable.flatMap((finding) => finding.itemIds.map((itemId) => generated.categoryByItemId[itemId])).filter(Boolean),
        ),
      ]) {
        const currentItem = proposal.items.find((item) => item.category === category);
        if (!currentItem) continue;
        const candidates = pool.filter(
          (candidate) => candidate.category === category && candidate.canonicalId !== currentItem.catalogId,
        );
        if (candidates.length > 0) {
          implicated.push({ category, currentItem: { category, label: currentItem.label, spec: currentItem.spec }, candidates });
        }
      }
      if (implicated.length === 0) break;

      let adopted = false;
      for (const entry of implicated) {
        const swap = await input.tryModelSwap({
          findings: actionable.map((finding) => ({
            ruleId: finding.ruleId,
            status: finding.status,
            conclusion: finding.conclusion,
            suggestedAction: finding.suggestedAction,
          })),
          currentItem: entry.currentItem,
          candidates: entry.candidates,
        });
        if (!swap) continue; // 模型认为该类别没有更优候选
        if (swap.category !== entry.category) continue; // 类别错配的提案忽略
        const candidate = entry.candidates.find((candidate) => candidate.canonicalId === swap.catalogId);
        if (!candidate) continue; // 兜底：池外 ID 不采纳

        const regenerated = generateDesignProposal({
          requestId: input.requestId,
          intent: input.intent,
          candidates: pool,
          version: 1,
          preferredIds: { ...preferredIds, [entry.category]: swap.catalogId },
          rationaleByCategory: { ...rationaleByCategory, [entry.category]: swap.reason },
          qualityContextByCanonicalId: qualityByCanonicalId,
          compatibilityCheck: (items) => {
            const checked = tools.runCompatibilityCheck({
              items: items.map((item) => ({
                category: item.category,
                label: item.label,
                spec: item.spec,
                fieldQuality: item.fieldQuality,
              })),
            });
            compatibilityToolRuleIds = checked.map((item) => item.ruleId);
            return [...checked];
          },
        });
        if (regenerated.status !== "ok") continue;
        const before = proposal.compatibility;
        const after = regenerated.proposal.compatibility;
        const improved =
          after.blockCount < before.blockCount ||
          (after.blockCount === before.blockCount && after.warnCount < before.warnCount);
        if (!improved) continue; // 未减少阻断/警告的换件不采纳
        proposal = regenerated.proposal;
        findings = regenerated.findings;
        adopted = true;
        runState.log(
          `第 ${iteration} 轮换件：${entry.category} → ${swap.catalogId}（阻断 ${before.blockCount}→${after.blockCount}，警告 ${before.warnCount}→${after.warnCount}）。`,
          { retrievalIds: [swap.catalogId] },
        );
        break;
      }
      if (!adopted) {
        runState.log(`第 ${iteration} 轮换件未产生可采纳的更优组合，保留原方案。`);
        break;
      }
      if (proposal.compatibility.status === "ok") break;
    }
  }

  // validated：grounding 验证 + 价格事实降级（基于迭代后的方案与发现）
  const grounding = validateProposalGrounding({
    proposal,
    priceByCanonicalId,
    findings,
    attemptId: input.attempt.attemptId,
  });
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
  runState.advance(`兼容性与主张验证完成（${proposal.compatibility.message}）。`, {
    retrievalIds: pool.map((candidate) => candidate.canonicalId),
    toolCalls: [
      {
        tool: "runCompatibilityCheck",
        attemptId: input.attempt.attemptId,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        resultIds: compatibilityToolRuleIds,
      },
    ],
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
  } catch (error) {
    // 内部错误细节只进服务器日志：审计事件不携带可泄露内部实现的文本
    console.error("[agent-orchestrator] 只读工具不可用：", error);
    runState.anomaly("只读工具暂时不可用，已阻止回答。", {
      errorCode: "TOOL_UNAVAILABLE",
    });
    return {
      status: "blocked",
      proposal: null,
      missingCategories: [],
      runtimeEvents: runState.all(),
      claims: [],
      attempts,
      fallbackReason: null,
      usedModelPath: false,
      selectedCategoryCount: 0,
      grounding: null,
      catalogSize: 0,
      poolSize: 0,
    };
  }
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
