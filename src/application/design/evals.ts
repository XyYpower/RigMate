import { parseDesignIntent } from "@/domain/design/intent";
import { buildCandidatePool, type CandidateSummary, type RankedCandidate, type VerifiedPriceFact } from "@/domain/catalog/ranking";
import { validateSelectionOutput } from "./intent-llm";
import { generateDesignProposal } from "@/domain/design/proposal";
import type { DesignProposal } from "@/contracts/design";
import type { BuildItemCategory } from "@/domain/build/types";

/**
 * 受约束选件评测 harness（内核恢复计划 Task D）。
 *
 * 输入固定案例（data/evals/design-selection-cases.json），对每个案例记录：
 * 检索候选、最终选择、质量状态、价格证据、规则结果和 unknown 项。
 * unsupported claim rate：模型选出候选池之外的型号/类别，或方案项编造规格/价格的比率——必须为 0。
 */

export const EVAL_CATEGORIES: BuildItemCategory[] = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"];

export type DesignEvalCase = {
  id: string;
  goal: string;
  /** 期望在规则式排序下第一名的候选（有则断言） */
  expectTopPick?: { category: string; canonicalId: string };
  /** 期望缺失的类别（候选不足/无匹配类案例） */
  expectMissingCategories?: string[];
  /** 期望方案排除的类别（已有硬件场景：池里有候选，但方案不含） */
  expectProposalExcludes?: string[];
  /** 模型受控响应：模拟本次运行中模型输出的 selections（或超时/非法输出） */
  model?: { selections?: Array<{ category: string; catalogId: string; reason: string }>; extraFields?: Record<string, unknown>; fail?: string };
  /** 期望守卫拒绝模型输出（非法 ID/越权字段等） */
  expectModelRejected?: boolean;
  /** 期望方案包含（存在时） */
  expectProposalContains?: { category: string; labelContains: string };
};

export type DesignEvalCaseResult = {
  id: string;
  passed: boolean;
  poolSize: number;
  poolIdsByCategory: Record<string, string[]>;
  /** 规则式第一名（排序路径） */
  rulePick: Record<string, string | null>;
  modelSelection?: Partial<Record<BuildItemCategory, string>>;
  modelRejectedReason?: string;
  missingCategories: string[];
  proposalItems: Array<{ category: string; label: string; qualityStatus: string; priceBasis: string; sourceLevel: string }>;
  unsupportedClaims: string[];
  failures: string[];
};

export type DesignEvalInput = {
  entries: RankedCandidate[];
  priceByCanonicalId: Map<string, VerifiedPriceFact>;
};

export async function runDesignEvalCase(
  testCase: DesignEvalCase,
  input: DesignEvalInput,
): Promise<DesignEvalCaseResult> {
  const intent = parseDesignIntent({ rawInput: testCase.goal });
  const { pool, missingCategories } = buildCandidatePool(input.entries, intent, EVAL_CATEGORIES, input.priceByCanonicalId);
  const result: DesignEvalCaseResult = {
    id: testCase.id,
    passed: true,
    poolSize: pool.length,
    poolIdsByCategory: {},
    rulePick: {},
    missingCategories: [...missingCategories],
    proposalItems: [],
    unsupportedClaims: [],
    failures: [],
  };
  for (const candidate of pool) {
    (result.poolIdsByCategory[candidate.category] ??= []).push(candidate.canonicalId);
  }

  // 规则式路径：取每类第一名并生成方案（模型不可用/被拒时的必经路径）
  const preferred: Partial<Record<BuildItemCategory, string>> = {};
  for (const candidate of pool) {
    if (!preferred[candidate.category]) preferred[candidate.category] = candidate.canonicalId;
    result.rulePick[candidate.category] ??= candidate.canonicalId;
  }
  const generated = generateDesignProposal({ requestId: "00000000-0000-4000-8000-00000000e001", intent, candidates: pool });
  if (generated.status === "ok") {
    for (const item of generated.proposal.items) {
      result.proposalItems.push({
        category: item.category,
        label: item.label,
        qualityStatus: item.qualityStatus,
        priceBasis: item.priceBasis,
        sourceLevel: item.sourceLevel,
      });
      // 不支持的主张核查：方案项必须能回溯到候选池（不存在的型号/编造来源即 unsupported claim）
      const source = pool.find((candidate) => candidate.canonicalId === item.catalogId);
      if (!source) result.unsupportedClaims.push(`proposal:${item.category}:${item.label}`);
      if (item.sourceLevel !== "verified_catalog" && item.sourceLevel !== "supported_catalog") {
        result.unsupportedClaims.push(`sourceLevel:${item.category}:${item.sourceLevel}`);
      }
      if (item.priceBasis === "evidence" && item.priceEstimateLowCents === null) {
        result.unsupportedClaims.push(`price:${item.category}`);
      }
    }
  }

  // 期望断言：规则第一名
  if (testCase.expectTopPick) {
    const pick = result.rulePick[testCase.expectTopPick.category];
    if (pick !== testCase.expectTopPick.canonicalId) {
      result.failures.push(`rulePick.${testCase.expectTopPick.category}=${pick}，期望 ${testCase.expectTopPick.canonicalId}`);
    }
  }
  if (testCase.expectMissingCategories) {
    const missing = [...missingCategories].sort().join(",");
    const expected = [...testCase.expectMissingCategories].sort().join(",");
    if (missing !== expected) result.failures.push(`missingCategories=${missing}，期望 ${expected}`);
  }
  if (testCase.expectProposalExcludes && generated.status === "ok") {
    const present = generated.proposal.items
      .filter((item) => testCase.expectProposalExcludes!.includes(item.category))
      .map((item) => item.category);
    if (present.length > 0) result.failures.push(`方案不应包含：${present.join("、")}`);
  }
  if (testCase.expectProposalContains && generated.status === "ok") {
    const item = generated.proposal.items.find((candidate) => candidate.category === testCase.expectProposalContains!.category);
    if (!item || !item.label.includes(testCase.expectProposalContains.labelContains)) {
      result.failures.push(`方案未包含 ${testCase.expectProposalContains.category}:${testCase.expectProposalContains.labelContains}`);
    }
  }

  // 模型受控响应：验证守卫（非法 ID/越权字段/超时都走这里断言回退路径可用）
  if (testCase.model) {
    if (testCase.model.fail) {
      result.modelRejectedReason = testCase.model.fail;
    } else {
      const raw = { selections: testCase.model.selections ?? [], ...(testCase.model.extraFields ?? {}) };
      // extraFields 模拟越权输出：strict schema 会抛错，这里手动判定为拒绝
      if (testCase.model.extraFields && Object.keys(testCase.model.extraFields).length > 0) {
        result.modelRejectedReason = "越权字段：模型输出了 selections 之外的内容";
      } else {
        const guard = validateSelectionOutput(pool, raw.selections);
        if (!guard.ok) {
          result.modelRejectedReason = guard.reason;
        } else {
          result.modelSelection = guard.data.selectedIds;
          for (const [category, canonicalId] of Object.entries(guard.data.selectedIds)) {
            if (!pool.some((candidate) => candidate.canonicalId === canonicalId && candidate.category === category)) {
              result.unsupportedClaims.push(`model:${category}:${canonicalId}`);
            }
          }
        }
      }
      if (testCase.expectModelRejected && !result.modelRejectedReason) {
        result.failures.push("期望模型输出被守卫拒绝，但守卫放行了");
      }
    }
  }

  result.passed = result.failures.length === 0 && result.unsupportedClaims.length === 0;
  return result;
}

export function summarizeEvalResults(results: DesignEvalCaseResult[]): {
  total: number;
  passed: number;
  failed: string[];
  unsupportedClaimRate: number;
} {
  const failed = results.filter((result) => !result.passed).map((result) => result.id);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed,
    unsupportedClaimRate: results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.unsupportedClaims.length, 0) / results.length,
  };
}

/**
 * 可测量增益（v2 Phase 6）：同一 CandidateSet 上，模型选择相对规则排序的逐类价格差。
 * 约定：只有当模型选择与规则选择都通过全部质量/守卫验证时才计入；
 * gain = 规则价 − 模型价（正数 = 模型在同一质量约束下更省）。不做质量加权——
 * 两个选择都必须来自质量门候选池，质量维度没有可让渡空间。
 */
export function measureSelectionGain(
  pool: CandidateSummary[],
  rulePick: Partial<Record<string, string>>,
  modelPick: Partial<Record<string, string>>,
): {
  categories: string[];
  /** 各类别增益（分）；null = 该类别无法比较（一侧未选或无价格） */
  byCategory: Record<string, number | null>;
  /** 可比较类别上的总增益（分）；无可比较类别时为 0 */
  totalCents: number;
  comparable: number;
} {
  const byId = new Map(pool.map((candidate) => [candidate.canonicalId, candidate]));
  const categories = [...new Set([...Object.keys(rulePick), ...Object.keys(modelPick)])].sort();
  const byCategory: Record<string, number | null> = {};
  let totalCents = 0;
  let comparable = 0;
  for (const category of categories) {
    const ruleId = rulePick[category];
    const modelId = modelPick[category];
    if (!ruleId || !modelId) {
      byCategory[category] = null;
      continue;
    }
    const rulePrice = byId.get(ruleId)?.priceCents ?? null;
    const modelPrice = byId.get(modelId)?.priceCents ?? null;
    if (rulePrice === null || modelPrice === null) {
      byCategory[category] = null;
      continue;
    }
    const gain = rulePrice - modelPrice;
    byCategory[category] = gain;
    totalCents += gain;
    comparable += 1;
  }
  return { categories, byCategory, totalCents, comparable };
}

export type EvalProposalSnapshot = DesignProposal;
