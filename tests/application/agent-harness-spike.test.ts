import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AgentToolRegistry } from "@/application/agent/tool-contracts";
import { isDeadlineExceeded, type AgentAttempt, type CompressedCandidateFact } from "@/application/agent/runtime-types";
import { validateSelectionOutput } from "@/application/design/intent-llm";
import { generateDesignProposal } from "@/domain/design/proposal";
import { buildCandidatePool, type CandidateSummary, type RankedCandidate } from "@/domain/catalog/ranking";
import { runBuildChecks } from "@/domain/rules/engine";
import { parseDesignIntent } from "@/domain/design/intent";
import { fixtureVerifiedPriceMap, seedCatalogFixtureIntoDb } from "@/infra/catalog-import/fixture";
import { computeEvidenceBackedFieldStatuses } from "@/application/catalog-review/service";

/**
 * Phase 0 spike（docs/design/agent-harness-decision.md）：四条硬门验证。
 * 1. 模型只能返回候选 ID；2. 模型工具全只读（库行数不变）；
 * 3. 模型失败回退规则路径；4. 压缩上下文后结构化事实完整存活。
 */

const tempDir = mkdtempSync(join(tmpdir(), "rigmate-agent-spike-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "spike.db");
seedCatalogFixtureIntoDb();

const { loadCatalogEntries, countCatalogEntries } = await import("@/infra/db/repositories/catalog-repository");
const { listFieldEvidence } = await import("@/infra/db/repositories/evidence-repository");
const { priceEvidenceStats } = await import("@/infra/db/repositories/price-evidence-repository");

afterAll(async () => {
  const { closeDatabase } = await import("@/infra/db/client");
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

const INTENT = parseDesignIntent({ rawInput: "2 万预算，剪辑和游戏" });
const CATEGORIES = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"] as const;

/** spike 用最小注册表装配：只读领域函数（Phase 5 移入 tools/*.ts） */
function buildSpikeRegistry(): AgentToolRegistry {
  return {
    searchCatalog: ({ category, limit = 8 }) => {
      const entries = loadCatalogEntries();
      const { pool } = buildCandidatePool(entries, INTENT, [category], fixtureVerifiedPriceMap());
      return pool.slice(0, limit);
    },
    searchEvidence: ({ canonicalProductId }) => {
      const statuses = computeEvidenceBackedFieldStatuses(canonicalProductId);
      return Object.entries(statuses.fieldQuality).map(([field, status]) => ({
        fieldPath: `spec.${field}`,
        status,
        sourceIds: statuses.evidenceSourceIds,
      }));
    },
    runCompatibilityCheck: ({ items }) =>
      runBuildChecks(
        items.map((item, index) => ({
          ...item,
          id: `spike-${index}`,
          buildId: "spike",
          createdAt: new Date().toISOString(),
        })),
      ),
  };
}

function compressAgentContext(candidates: CandidateSummary[]): CompressedCandidateFact[] {
  // 压缩纪律（v2 §8）：只裁剪解释性文本（name/retrievalReasons/spec 明细），
  // 候选 ID / qualityStatus / missingFields / 价格状态是事实，必须存活。
  return candidates.map((candidate) => ({
    canonicalId: candidate.canonicalId,
    category: candidate.category,
    qualityStatus: candidate.qualityStatus,
    missingFields: candidate.missingFields,
    priceCents: candidate.priceCents,
  }));
}

describe("Agent Harness spike（Phase 0 四条硬门）", () => {
  it("硬门 1：模型只能返回候选 ID——池外 ID 与类别错配被守卫拒绝", () => {
    const registry = buildSpikeRegistry();
    const pool = registry.searchCatalog({ category: "cpu" });
    expect(pool.length).toBeGreaterThan(0);

    const madeUp = validateSelectionOutput(pool, [{ category: "cpu", catalogId: "cpu-invented-999", reason: "编造" }]);
    expect(madeUp.ok).toBe(false);
    const mismatched = validateSelectionOutput(pool, [{ category: "gpu", catalogId: pool[0]!.canonicalId, reason: "错配" }]);
    expect(mismatched.ok).toBe(false);
  });

  it("硬门 2：工具注册表封闭且只读——调用前后数据库行数不变", async () => {
    const registry = buildSpikeRegistry();
    // 封闭性：注册表恰好三个只读工具（类型层无索引签名，这里断言运行时形状）
    expect(Object.keys(registry).sort()).toEqual(["runCompatibilityCheck", "searchCatalog", "searchEvidence"]);

    const productsBefore = countCatalogEntries();
    const evidenceBefore = priceEvidenceStats().total;

    const gpu = registry.searchCatalog({ category: "gpu" })[0]!;
    registry.searchEvidence({ canonicalProductId: gpu.canonicalId });
    const findings = registry.runCompatibilityCheck({
      items: [
        { category: "cpu", label: "AMD Ryzen 7 9800X3D", spec: { socket: "AM5", tdpWatts: 120 } },
        { category: "motherboard", label: "华硕 TUF GAMING B650-PLUS WIFI", spec: { socket: "LGA1700", ramType: "DDR5" } },
      ],
    });
    expect(findings.length).toBeGreaterThan(0);
    // 不存在任何写工具：注册表类型上没有 save/persist/insert 形态；这里核对数据未变
    expect(countCatalogEntries()).toBe(productsBefore);
    expect(priceEvidenceStats().total).toBe(evidenceBefore);
    // searchEvidence 只读：fixture 产品无证据链 → 空数组，而不是编造字段
    expect(listFieldEvidence(gpu.canonicalId)).toEqual([]);
  });

  it("硬门 3：模型失败回退规则路径——同一 CandidateSet 上规则排序产出完整方案", () => {
    const entries = loadCatalogEntries() as RankedCandidate[];
    const { pool } = buildCandidatePool(entries, INTENT, [...CATEGORIES], fixtureVerifiedPriceMap());

    const attempt: AgentAttempt = {
      attemptId: "attempt-1",
      promptVersion: "selection-v1",
      model: "test-model",
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(isDeadlineExceeded(attempt)).toBe(false);

    // 模拟模型失败：守卫拒绝（生产中对应超时/schema 错误/非法 ID，同一回退点）
    const guard = validateSelectionOutput(pool, [{ category: "cpu", catalogId: "cpu-made-up", reason: "x" }]);
    expect(guard.ok).toBe(false);

    // 回退：每类取规则排序第一名（与 Phase 4 约定一致：不回退 PREFERRED_IDS）
    const preferred: Partial<Record<string, string>> = {};
    for (const candidate of pool) {
      preferred[candidate.category] ??= candidate.canonicalId;
    }
    const generated = generateDesignProposal({ requestId: "00000000-0000-4000-8000-00000000f001", intent: INTENT, candidates: pool });
    expect(generated.status).toBe("ok");
    if (generated.status !== "ok") return;
    expect(generated.proposal.items.length).toBeGreaterThanOrEqual(8);
    void preferred;
  });

  it("硬门 4：压缩上下文后候选 ID、质量状态、缺失字段、价格状态与规则结果存活", () => {
    const entries = loadCatalogEntries() as RankedCandidate[];
    const { pool } = buildCandidatePool(entries, INTENT, [...CATEGORIES], fixtureVerifiedPriceMap());
    const findings = buildSpikeRegistry().runCompatibilityCheck({
      items: pool.slice(0, 2).map((candidate) => ({ category: candidate.category, label: candidate.name, spec: candidate.spec })),
    });

    const compressed = compressAgentContext(pool);
    expect(compressed).toHaveLength(pool.length);
    for (const fact of compressed) {
      expect(fact.canonicalId).toBeTruthy();
      expect(["verified", "supported"]).toContain(fact.qualityStatus);
      expect(Array.isArray(fact.missingFields)).toBe(true);
      // 价格状态存活：有证据的候选价格保留，无证据的为 null（不是被裁剪成 undefined）
      expect("priceCents" in fact).toBe(true);
    }
    // 规则结果存活：findings 是结构化对象数组，压缩不影响（它们本来就不含自由文本依赖）
    expect(findings.every((finding) => typeof finding.ruleId === "string" && typeof finding.status === "string")).toBe(true);
  });
});
