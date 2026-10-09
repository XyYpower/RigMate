import { describe, expect, it } from "vitest";
import {
  renderCatalogSelectionPrompt,
  selectCatalogCandidatesWithLlm,
  validateSelectionOutput,
} from "@/application/design/intent-llm";
import type { CandidateSummary } from "@/domain/catalog/ranking";

const config = {
  baseUrl: "https://gw.example.com/v1",
  apiKey: "sk-test",
  model: "test-model",
  timeoutMs: 1000,
};

const candidates: CandidateSummary[] = [
  {
    canonicalId: "cpu-9600x",
    category: "cpu",
    name: "AMD Ryzen 5 9600X",
    spec: { socket: "AM5", tdpWatts: 65 },
    qualityStatus: "supported",
    sourceIds: [],
    missingFields: [],
    priceCents: 239_900,
    retrievalReasons: ["必填字段 2/2 完整", "已审核价格 ¥2,399 在预算内"],
  },
  {
    canonicalId: "cpu-partial-x",
    category: "cpu",
    name: "演示 partial",
    spec: {},
    qualityStatus: "supported",
    sourceIds: [],
    missingFields: ["socket", "tdpWatts"],
    priceCents: null,
    retrievalReasons: ["必填字段缺 socket、tdpWatts"],
  },
  {
    canonicalId: "gpu-rtx4060",
    category: "gpu",
    name: "NVIDIA RTX 4060",
    spec: { tdpWatts: 115 },
    qualityStatus: "verified",
    sourceIds: ["src-1"],
    missingFields: [],
    priceCents: 239_900,
    retrievalReasons: ["必填字段 1/1 完整"],
  },
];

function llmFetchWith(content: string) {
  return async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("受约束的候选选择（内核恢复 Task D）", () => {
  it("只接受候选池中存在的 catalogId，并保留模型理由", async () => {
    const result = await selectCatalogCandidatesWithLlm({
      intent: { budgetCents: 800_000, useCases: ["游戏"], appearance: [], existingParts: [], constraints: [], region: "中国大陆" },
      candidates,
      config,
      fetchImpl: llmFetchWith('{"selections":[{"category":"cpu","catalogId":"cpu-9600x","reason":"预算内保留 AM5 平台"}]}'),
    });
    expect(result).toEqual({
      ok: true,
      data: { selectedIds: { cpu: "cpu-9600x" }, rationaleByCategory: { cpu: "预算内保留 AM5 平台" } },
    });
  });

  it("模型返回候选池之外的型号或类别不符时拒绝，不把它带入方案", async () => {
    const madeUp = await selectCatalogCandidatesWithLlm({
      intent: { budgetCents: 800_000, useCases: ["游戏"], appearance: [], existingParts: [], constraints: [], region: "中国大陆" },
      candidates,
      config,
      fetchImpl: llmFetchWith('{"selections":[{"category":"gpu","catalogId":"gpu-made-up","reason":"更强"}]}'),
    });
    expect(madeUp.ok).toBe(false);

    const mismatched = validateSelectionOutput(candidates, [
      { category: "gpu", catalogId: "cpu-9600x", reason: "类别错配" },
    ]);
    expect(mismatched.ok).toBe(false);
    expect(mismatched).toEqual({ ok: false, reason: "模型选择了候选列表之外的型号或不匹配的类别" });
  });

  it("越权字段（schema 之外的键）导致整体拒绝并回退规则式", async () => {
    const result = await selectCatalogCandidatesWithLlm({
      intent: { budgetCents: 800_000, useCases: ["游戏"], appearance: [], existingParts: [], constraints: [], region: "中国大陆" },
      candidates,
      config,
      fetchImpl: llmFetchWith(
        '{"selections":[{"category":"cpu","catalogId":"cpu-9600x","reason":"ok"}],"inventedSpec":{"socket":"X999"}}',
      ),
    });
    expect(result.ok).toBe(false);
  });

  it("重复类别只保留首个选择；未知类别被忽略", () => {
    const result = validateSelectionOutput(candidates, [
      { category: "cpu", catalogId: "cpu-9600x", reason: "首选" },
      { category: "cpu", catalogId: "cpu-partial-x", reason: "重复（忽略）" },
      { category: "watercooler", catalogId: "cpu-9600x", reason: "未知类别（忽略）" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.selectedIds).toEqual({ cpu: "cpu-9600x" });
    }
  });

  it("候选摘要只透出有限字段（含质量状态与缺失字段），不暴露数据库形态", () => {
    const prompt = renderCatalogSelectionPrompt({
      intent: { budgetCents: 800_000, useCases: [], appearance: [], existingParts: [], constraints: [], region: "中国大陆" },
      candidates,
    });
    expect(prompt).toContain("qualityStatus");
    expect(prompt).toContain("missingFields");
    expect(prompt).toContain("verifiedPriceCents");
    expect(prompt).not.toContain("sourceIds");
    expect(prompt).not.toContain("canonicalProductId");
  });
});
