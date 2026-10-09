import { describe, expect, it } from "vitest";
import { parseDesignIntent, designTitle, intentNeedsInput } from "@/domain/design/intent";
import { generateDesignProposal } from "@/domain/design/proposal";
import { buildCandidatePool, rankCandidates } from "@/domain/catalog/ranking";
import {
  fixtureCatalogEntries,
  fixtureVerifiedPriceMap,
} from "@/infra/catalog-import/fixture";
import type { RankedCandidate } from "@/domain/catalog/ranking";

const INTENT = parseDesignIntent({ rawInput: "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏" });

function rankedFixtureCandidates() {
  const entries = fixtureCatalogEntries().filter((entry) => entry.qualityStatus !== "partial");
  return buildCandidatePool(
    entries as RankedCandidate[],
    INTENT,
    ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"],
    fixtureVerifiedPriceMap(),
  );
}

describe("目标意图解析", () => {
  it("识别中文预算、用途和外观", () => {
    const intent = parseDesignIntent({ rawInput: "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏" });
    expect(intent.budgetCents).toBe(2_000_000);
    expect(intent.useCases).toEqual(["视频剪辑", "游戏"]);
    expect(intent.appearance).toEqual(["白色", "海景房"]);
    expect(designTitle(intent)).toBe("白色 · 海景房 · 视频剪辑 + 游戏");
    expect(intentNeedsInput(intent)).toBe(false);
  });

  it("预算和用途都缺少时要求最小追问", () => {
    const intent = parseDesignIntent({ rawInput: "帮我配一台电脑" });
    expect(intent.budgetCents).toBeNull();
    expect(intent.useCases).toEqual([]);
    expect(intentNeedsInput(intent)).toBe(true);
  });
});

describe("质量门候选检索（内核恢复 Task A/B）", () => {
  it("partial/conflicting 候选被质量门排除，不能凑齐八类", () => {
    const { pool, missingCategories } = buildCandidatePool(
      fixtureCatalogEntries() as RankedCandidate[],
      INTENT,
      ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"],
      fixtureVerifiedPriceMap(),
    );
    expect(pool.some((candidate) => candidate.canonicalId === "cpu-partial-demo")).toBe(false);
    expect(pool.length).toBeGreaterThan(0);
    // partial 只出现在 cpu：cpu 类别仍有其余 supported 候选，缺失类别为空
    expect(missingCategories).toEqual([]);
  });

  it("候选池为空的类别进入缺失清单，且排序带可解释理由", () => {
    const onlyCooler = fixtureCatalogEntries().filter((entry) => entry.category === "cooler");
    const { pool, missingCategories } = buildCandidatePool(
      onlyCooler as RankedCandidate[],
      INTENT,
      ["cpu", "cooler"],
      new Map(),
    );
    expect(pool.map((candidate) => candidate.category)).toEqual(["cooler"]);
    expect(missingCategories).toEqual(["cpu"]);
    expect(pool[0]!.retrievalReasons.join("；")).toContain("暂无已审核价格");
  });

  it("预算超支强惩罚、预算内更高档优先（取代旧 if/else 档位）", () => {
    const gpus = fixtureCatalogEntries().filter((entry) => entry.category === "gpu");
    const prices = fixtureVerifiedPriceMap();
    const highBudget = rankCandidates(gpus as RankedCandidate[], { ...INTENT, budgetCents: 2_000_000 }, prices);
    expect(highBudget[0]!.canonicalId).toBe("gpu-rtx4070s");

    const tightBudget = rankCandidates(
      gpus as RankedCandidate[],
      { ...INTENT, budgetCents: 300_000 },
      prices,
    );
    expect(tightBudget[0]!.canonicalId).toBe("gpu-rtx4060");
    expect(tightBudget[0]!.retrievalReasons.join("；")).toContain("在预算内");
    expect(highBudget.find((candidate) => candidate.canonicalId === "gpu-rtx4060")).toBeDefined();
  });
});

describe("方案生成（内核恢复 Task A/C）", () => {
  it("质量门候选生成方案：来源按真实质量映射，价格来自已审核证据", () => {
    const { pool } = rankedFixtureCandidates();
    const result = generateDesignProposal({
      requestId: "00000000-0000-4000-8000-000000000000",
      intent: INTENT,
      candidates: pool,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const { proposal, findings } = result;
    expect(proposal.items.length).toBeGreaterThanOrEqual(8);
    // 支持硬编码 verified：fixture 全部 supported → supported_catalog
    for (const item of proposal.items) {
      expect(item.sourceLevel).toBe("supported_catalog");
      expect(item.qualityStatus).toBe("supported");
      expect(item.priceBasis).toBe("evidence");
      expect(item.priceEstimateLowCents).toBeGreaterThan(0);
    }
    expect(proposal.estimatedLowCents!).toBeGreaterThan(0);
    expect(proposal.unknowns.join("；")).toContain("非实时成交价");
    expect(["ok", "attention", "unknown", "conflict"]).toContain(proposal.compatibility.status);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("没有价格证据时：价格上下限为 null、priceBasis=unknown，不猜价格", () => {
    const { pool } = rankedFixtureCandidates();
    const result = generateDesignProposal({
      requestId: "00000000-0000-4000-8000-000000000001",
      intent: INTENT,
      candidates: pool.map((candidate) => ({ ...candidate, priceCents: null })),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    for (const item of result.proposal.items) {
      expect(item.priceEstimateLowCents).toBeNull();
      expect(item.priceEstimateHighCents).toBeNull();
      expect(item.priceBasis).toBe("unknown");
    }
    expect(result.proposal.estimatedLowCents).toBeNull();
    expect(result.proposal.estimatedHighCents).toBeNull();
    expect(result.proposal.unknowns.join("；")).toContain("暂无已审核价格证据");
  });

  it("候选不足：缺失类别如实返回，不用 partial 凑齐八类", () => {
    const gpuOnly = fixtureCatalogEntries()
      .filter((entry) => entry.category === "gpu" && entry.qualityStatus === "supported")
      .map((entry) => entry);
    const { pool } = buildCandidatePool(
      gpuOnly as RankedCandidate[],
      INTENT,
      ["cpu", "motherboard", "gpu"],
      new Map(),
    );
    const result = generateDesignProposal({
      requestId: "00000000-0000-4000-8000-000000000002",
      intent: INTENT,
      candidates: pool,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.proposal.items.map((item) => item.category)).toEqual(["gpu"]);
    expect(result.proposal.fitNotes.join("；")).toContain("候选不足");
    expect(result.proposal.unknowns.join("；")).toContain("处理器");

    const empty = generateDesignProposal({
      requestId: "00000000-0000-4000-8000-000000000003",
      intent: INTENT,
      candidates: [],
    });
    expect(empty.status).toBe("insufficient");
  });

  it("字段质量层随候选透出，不可用字段在规则检查中只能得到 unknown", () => {
    const { pool } = rankedFixtureCandidates();
    const qualityContext = new Map(
      pool.map((candidate) => [
        candidate.canonicalId,
        // 模拟"证据链判定来源过期"：字段有值但质量不可用 → 规则不得输出 pass
        { fieldQuality: { socket: "stale" as const }, evidenceSourceIds: ["src-1"] },
      ]),
    );
    const result = generateDesignProposal({
      requestId: "00000000-0000-4000-8000-000000000004",
      intent: parseDesignIntent({ rawInput: "2 万预算，剪辑和游戏" }),
      candidates: pool,
      qualityContextByCanonicalId: qualityContext,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const cpu = result.proposal.items.find((item) => item.category === "cpu");
    expect(cpu?.fieldQuality.socket).toBe("stale");
    expect(cpu?.evidenceSourceIds).toEqual(["src-1"]);
    expect(result.findings.some((finding) => finding.status === "unknown")).toBe(true);
    expect(result.proposal.compatibility.status).not.toBe("ok");
  });
});
