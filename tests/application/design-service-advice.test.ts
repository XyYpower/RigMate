import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// 混合建议层接入（hybrid-llm-advice 计划 Task 3）：
// 配置 LLM 时 advice 挂到方案并持久化；advice 失败方案照常；修订同样带建议。
// 环境桩：LLM 配置存在但 completeJson 一律失败——把"模型"变量隔离到 advice mock 一处，
// 意图解析/选件/换件都走既有降级路径，避免网络与超时噪声。
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-design-advice-svc-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "advice-svc.db");

vi.mock("@/infra/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infra/llm/client")>();
  return {
    ...actual,
    resolveLlmConfigFromEnv: () => ({
      baseUrl: "https://gw.example.com/v1",
      apiKey: "sk-test",
      model: "test-model",
      timeoutMs: 1000,
    }),
    completeJson: async () => ({ ok: false as const, reason: "测试桩：模型路径禁用" }),
  };
});

// advice 是本文件唯一要操控的模型变量：整函数替换为可编程 mock（Task 2 已测过其内部守卫）
vi.mock("@/application/design/advice-llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/application/design/advice-llm")>();
  return {
    ...actual,
    generateExperienceAdvice: vi.fn(),
  };
});

const { generateExperienceAdvice } = await import("@/application/design/advice-llm");
const generateAdviceMock = vi.mocked(generateExperienceAdvice);

const { seedCatalogFixtureIntoDb } = await import("@/infra/catalog-import/fixture");
seedCatalogFixtureIntoDb();

const service = await import("@/application/design/service");
const { closeDatabase } = await import("@/infra/db/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  generateAdviceMock.mockReset();
});

describe("设计服务 advice 接入（LLM 已配置）", () => {
  it("创建：正式 items 的 catalogId 仍全部来自候选池，experienceAdvice 挂方案且持久化", async () => {
    generateAdviceMock.mockResolvedValue({
      ok: true,
      data: [
        {
          kind: "external_product_hint",
          category: "case",
          title: "待验证产品",
          detail: "海景房机箱还有一款值得核验",
          productName: "某品牌海景房机箱",
          requiresVerification: true,
        },
      ],
    });
    const result = await service.createDesignRequest({ rawInput: "2 万预算，白色海景房，剪辑和游戏" });
    expect(result.proposal).not.toBeNull();
    // 正式来源红线：advice 通道存在，正式配置仍全部来自质量门候选池
    for (const item of result.proposal?.items ?? []) {
      expect(item.catalogId).toBeTruthy();
      expect(item.sourceLevel).toBe("supported_catalog");
    }
    // 非阻塞语义（M6）：响应立即返回、advice 异步补齐——响应里先为空
    expect(result.proposal?.experienceAdvice).toEqual([]);
    // 后台建议落库后就地可见
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reloaded = service.getDesignResult(result.request.id);
    expect(reloaded?.proposal?.experienceAdvice).toHaveLength(1);
    expect(reloaded?.proposal?.experienceAdvice[0]?.kind).toBe("external_product_hint");
    // 库外产品名绝不混进正式配置
    expect(
      (reloaded?.proposal?.items ?? []).some((item) => item.label.includes("某品牌海景房机箱")),
    ).toBe(false);
  });

  it("advice 失败（超时/schema）：方案照常生成，advice 为空", async () => {
    generateAdviceMock.mockResolvedValue({ ok: false, reason: "模型超时" });
    const result = await service.createDesignRequest({ rawInput: "2 万预算，剪辑和游戏" });
    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.experienceAdvice).toEqual([]);
  });

  it("修订：新版本同样保留建议通道", async () => {
    generateAdviceMock.mockResolvedValue({
      ok: true,
      data: [
        {
          kind: "experience_advice",
          category: "gpu",
          title: "显存取舍",
          detail: "剪辑用途优先更大显存",
          requiresVerification: false,
        },
      ],
    });
    const created = await service.createDesignRequest({ rawInput: "2 万预算，剪辑和游戏" });
    const revised = await service.reviseDesign(created.request.id, { instruction: "预算压到 1.8 万" });
    expect(revised.proposal?.version).toBe(2);
    // 非阻塞语义：修订响应立即返回（advice 异步补齐）
    expect(revised.proposal?.experienceAdvice).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reloaded = service.getDesignResult(created.request.id);
    expect(reloaded?.proposal?.experienceAdvice).toHaveLength(1);
    expect(generateAdviceMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
