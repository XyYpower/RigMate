import { describe, expect, it } from "vitest";
import { selectCatalogCandidatesWithLlm } from "@/application/design/intent-llm";

const config = {
  baseUrl: "https://gw.example.com/v1",
  apiKey: "sk-test",
  model: "test-model",
  timeoutMs: 1000,
};

const candidates = [
  { id: "cpu-9600x", category: "cpu" as const, name: "AMD Ryzen 5 9600X", spec: { socket: "AM5" }, aliases: [] },
  { id: "gpu-rtx4060", category: "gpu" as const, name: "NVIDIA RTX 4060", spec: { tdpWatts: 115 }, aliases: [] },
];

function llmFetchWith(content: string) {
  return async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("受约束的目录候选选择", () => {
  it("只接受目录中存在的 catalogId，并保留模型理由", async () => {
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

  it("模型返回不存在的型号时拒绝，不把它带入方案", async () => {
    const result = await selectCatalogCandidatesWithLlm({
      intent: { budgetCents: 800_000, useCases: ["游戏"], appearance: [], existingParts: [], constraints: [], region: "中国大陆" },
      candidates,
      config,
      fetchImpl: llmFetchWith('{"selections":[{"category":"gpu","catalogId":"gpu-made-up","reason":"更强"}]}'),
    });
    expect(result).toEqual({ ok: false, reason: "模型选择了不存在的目录型号" });
  });
});
