import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAgentAttempt, orchestrateDesignGeneration } from "@/application/agent/orchestrator";
import { parseDesignIntent } from "@/domain/design/intent";
import type { RankedCandidate } from "@/domain/catalog/ranking";
import { createAgentTools } from "@/application/agent/tools/registry";

/**
 * Agent 编排器测试（v2 Phase 5 §8）：
 * 状态机相位顺序、事件审计字段、守卫回退、池空/候选不足/grounding 阻断三条异常路径。
 */

const tempDir = mkdtempSync(join(tmpdir(), "rigmate-agent-orchestrator-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "orchestrator.db");

const { seedCatalogFixtureIntoDb } = await import("@/infra/catalog-import/fixture");
seedCatalogFixtureIntoDb();

const { loadCatalogEntries } = await import("@/infra/db/repositories/catalog-repository");
const { loadPriceContext } = await import("@/application/design/price-context");

afterAll(async () => {
  const { closeDatabase } = await import("@/infra/db/client");
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

const CATEGORIES = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"] as const;
const INTENT = parseDesignIntent({ rawInput: "2 万预算，白色海景房，剪辑和游戏" });

function attempt() {
  return createAgentAttempt({
    model: "test-model",
    promptVersion: "selection-v1",
    deadlineMs: 20_000,
  });
}

function fixtureRetrieve() {
  const entries = loadCatalogEntries() as RankedCandidate[];
  return {
    catalogSize: entries.length,
    entries,
    priceByCanonicalId: loadPriceContext({ region: "中国大陆" }),
  };
}

describe("Agent 编排器（Phase 5）", () => {
  it("工具复核是方案摘要和主张的唯一检查来源，调用一次", async () => {
    const context = fixtureRetrieve();
    const tools = createAgentTools(context);
    const realCheck = tools.runCompatibilityCheck;
    let checkCalls = 0;
    tools.runCompatibilityCheck = (input) => {
      checkCalls += 1;
      return realCheck(input).map((finding) => ({ ...finding, status: "unknown" as const }));
    };
    const result = await orchestrateDesignGeneration({
      requestId: "00000000-0000-4000-8000-00000000a007", intent: INTENT,
      attempt: attempt(), categories: CATEGORIES, retrieve: () => context, tools,
    });
    expect(checkCalls).toBe(1);
    expect(result.proposal?.compatibility.passCount).toBe(0);
    expect(result.proposal?.compatibility.status).toBe("unknown");
  });

  it("工具故障阻止回答并记录异常，不伪装成候选为空", async () => {
    const context = fixtureRetrieve();
    const tools = createAgentTools(context);
    tools.searchCatalog = () => { throw new Error("internal database detail"); };
    const result = await orchestrateDesignGeneration({
      requestId: "00000000-0000-4000-8000-00000000a008", intent: INTENT,
      attempt: attempt(), categories: CATEGORIES, retrieve: () => context, tools,
    });
    expect(result.status).toBe("blocked");
    expect(result.runtimeEvents.some((event) => event.errorCode === "TOOL_UNAVAILABLE")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("internal database detail");
  });

  it("正常路径：相位按主链推进，事件携带审计字段，主张全部入账", async () => {
    const outcome = await orchestrateDesignGeneration({
      requestId: "00000000-0000-4000-8000-00000000a001",
      intent: INTENT,
      attempt: attempt(),
      categories: [...CATEGORIES],
      retrieve: fixtureRetrieve,
    });
    expect(outcome.status).toBe("ok");
    expect(outcome.proposal?.items.length).toBe(8);
    expect(outcome.usedModelPath).toBe(false);
    expect(outcome.grounding?.ok).toBe(true);

    const phases = outcome.runtimeEvents.map((event) => event.phase);
    expect(phases).toEqual([
      "received",
      "screened",
      "understanding",
      "retrieved",
      "composed",
      "validated",
      "answered",
    ]);
    for (const event of outcome.runtimeEvents) {
      expect(event.attemptId).toBe(outcome.attempts[0]!.attemptId);
      expect(event.at).toBeTruthy();
    }
    // retrieved 事件携带检索命中与工具调用留痕（池 = 各类全部合格候选 15 条；提案取每类第一名 8 件）
    const retrieved = outcome.runtimeEvents.find((event) => event.phase === "retrieved");
    expect(retrieved?.retrievalIds?.length).toBe(15);
    for (const item of outcome.proposal?.items ?? []) {
      expect(retrieved?.retrievalIds).toContain(item.catalogId);
    }
    expect(retrieved?.toolCalls?.[0]?.tool).toBe("searchCatalog");
    expect(retrieved?.toolCalls?.some((call) => call.tool === "searchEvidence")).toBe(true);
    expect(outcome.runtimeEvents.find((event) => event.phase === "validated")?.toolCalls?.[0]?.tool).toBe("runCompatibilityCheck");

    // 主张：8 条 catalog_fact + 8 条 price_fact + 规则结果若干
    const kinds = outcome.claims.map((claim) => claim.kind);
    expect(kinds.filter((kind) => kind === "catalog_fact")).toHaveLength(8);
    expect(kinds.filter((kind) => kind === "price_fact")).toHaveLength(8);
    expect(kinds).toContain("rule_result");
  });

  it("模型路径：守卫通过的选择被采用（usedModelPath）", async () => {
    const outcome = await orchestrateDesignGeneration({
      requestId: "00000000-0000-4000-8000-00000000a002",
      intent: INTENT,
      attempt: attempt(),
      categories: [...CATEGORIES],
      retrieve: fixtureRetrieve,
      tryModelSelection: async (pool) => {
        const selected: Partial<Record<string, string>> = {};
        for (const candidate of pool) {
          selected[candidate.category] ??= candidate.canonicalId;
        }
        return { selectedIds: selected, rationaleByCategory: { cpu: "模型选择的理由" } };
      },
    });
    expect(outcome.status).toBe("ok");
    expect(outcome.usedModelPath).toBe(true);
    expect(outcome.selectedCategoryCount).toBe(8);
    expect(outcome.fallbackReason).toBeNull();
    expect(outcome.proposal?.items.find((item) => item.category === "cpu")?.rationale).toBe("模型选择的理由");
  });

  it("守卫拒绝 → 回退规则排序：anomaly + fallback 事件留痕，方案照常产出", async () => {
    const outcome = await orchestrateDesignGeneration({
      requestId: "00000000-0000-4000-8000-00000000a003",
      intent: INTENT,
      attempt: attempt(),
      categories: [...CATEGORIES],
      retrieve: fixtureRetrieve,
      tryModelSelection: async () => null,
    });
    expect(outcome.status).toBe("ok");
    expect(outcome.usedModelPath).toBe(false);
    expect(outcome.fallbackReason).toContain("模型路径");
    const anomaly = outcome.runtimeEvents.find((event) => event.phase === "anomaly");
    expect(anomaly?.errorCode).toBe("MODEL_FALLBACK");
    expect(anomaly?.fallback).toEqual({
      reason: outcome.fallbackReason,
      from: "test-model",
      to: "rule-engine",
    });
    // 规则路径仍然给出完整方案
    expect(outcome.proposal?.items.length).toBe(8);
  });

  it("池空：empty_pool + EMPTY_CANDIDATE_POOL，不产出方案", async () => {
    const outcome = await orchestrateDesignGeneration({
      requestId: "00000000-0000-4000-8000-00000000a004",
      intent: INTENT,
      attempt: attempt(),
      categories: [...CATEGORIES],
      retrieve: () => ({ catalogSize: 0, entries: [], priceByCanonicalId: new Map() }),
    });
    expect(outcome.status).toBe("empty_pool");
    expect(outcome.proposal).toBeNull();
    const anomaly = outcome.runtimeEvents.find((event) => event.phase === "anomaly");
    expect(anomaly?.errorCode).toBe("EMPTY_CANDIDATE_POOL");
  });

  it("候选不足：insufficient 携带缺失类别", async () => {
    const outcome = await orchestrateDesignGeneration({
      requestId: "00000000-0000-4000-8000-00000000a005",
      intent: INTENT,
      attempt: attempt(),
      categories: ["cpu", "gpu"],
      retrieve: () => ({
        catalogSize: 2,
        entries: loadCatalogEntries().filter((entry) => entry.category === "gpu") as RankedCandidate[],
        priceByCanonicalId: new Map(),
      }),
    });
    // 池级缺失如实返回（cpu 无候选）；gpu 可选时生成器产出单件方案并诚实标注，不硬凑八类
    expect(outcome.missingCategories).toEqual(["cpu"]);
    expect(outcome.proposal?.items.map((item) => item.category)).toEqual(["gpu"]);
    expect(outcome.proposal?.fitNotes.join("；")).toContain("候选不足");
  });

  it("超过截止时间：模型尝试直接跳过并回退规则", async () => {
    const expired = attempt();
    expired.deadlineAt = new Date(Date.now() - 1000).toISOString();
    let modelCalled = false;
    const outcome = await orchestrateDesignGeneration({
      requestId: "00000000-0000-4000-8000-00000000a006",
      intent: INTENT,
      attempt: expired,
      categories: [...CATEGORIES],
      retrieve: fixtureRetrieve,
      tryModelSelection: async () => {
        modelCalled = true;
        return null;
      },
    });
    expect(modelCalled).toBe(false);
    expect(outcome.status).toBe("ok");
    expect(outcome.fallbackReason).toContain("截止时间");
  });
});
