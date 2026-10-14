import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// M1 修订合并守卫接线（launch-readiness Phase 2）：
// 模型修订返回完整意图时，服务端只接受用户明确触及的字段变化，
// 漂移字段还原 before 值并落 revision_merged 审计事件。
// 环境桩：LLM 配置存在；意图解析/选件一律失败走规则，只有"方案调整器"调用返回漂移意图。
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-revision-merge-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "merge.db");

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
    completeJson: vi.fn(async (options: { system: string }) => {
      // 只有修订调用成功，返回「清空预算 + 改外观」的漂移意图（注意：LLM 层用 budgetYuan 元）
      if (options.system.includes("方案调整器")) {
        return {
          ok: true as const,
          data: {
            budgetYuan: null,
            useCases: ["视频剪辑"],
            appearance: ["白色", "海景房"],
            existingParts: [],
            constraints: [],
            region: "中国大陆",
          },
        };
      }
      return { ok: false as const, reason: "测试桩：其余模型路径禁用" };
    }),
  };
});

const { seedCatalogFixtureIntoDb } = await import("@/infra/catalog-import/fixture");
seedCatalogFixtureIntoDb();

const service = await import("@/application/design/service");
const { ensureDatabase, closeDatabase } = await import("@/infra/db/client");
const { completeJson } = await import("@/infra/llm/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(completeJson).mockClear();
});

function revisionMergedEvents(requestId: string): Array<Record<string, unknown>> {
  const rows = ensureDatabase().all<{ payload: string }>(
    sql`SELECT payload FROM agent_event_log WHERE request_id = ${requestId} AND payload LIKE '%"revision_merged"%' ORDER BY seq`,
  );
  return rows.map((row) => JSON.parse(row.payload).payload ?? JSON.parse(row.payload));
}

describe("修订合并守卫接线（LLM 已配置，模型返回漂移意图）", () => {
  it("指令只改外观：预算漂移被拒绝，外观生效，revision_merged 审计落库", async () => {
    const created = await service.createDesignRequest({ rawInput: "2 万预算，剪辑和游戏" });
    expect(created.proposal).not.toBeNull();
    const beforeBudget = created.request.intent.budgetCents;
    expect(beforeBudget).toBe(2_000_000);

    const revised = await service.reviseDesign(created.request.id, { instruction: "机箱要白色海景房" });

    expect(revised.proposal?.version).toBe(2);
    // 预算没有被模型清空：来源优先级保住 before 值
    expect(revised.request.intent.budgetCents).toBe(2_000_000);
    // 触及的外观字段被接受
    expect(revised.request.intent.appearance).toEqual(["白色", "海景房"]);
    // 未触及字段原样保留：模型偷偷删掉"游戏"也被守卫还原
    expect(revised.request.intent.useCases).toEqual(["视频剪辑", "游戏"]);

    const events = revisionMergedEvents(created.request.id);
    expect(events).toHaveLength(1);
    const event = events[0] as {
      instruction: string;
      changedFields: string[];
      rejectedFields: string[];
      beforeIntent: { budgetCents: number };
      mergedIntent: { budgetCents: number };
    };
    expect(event.instruction).toBe("机箱要白色海景房");
    expect(event.changedFields).toEqual(["appearance"]);
    // 模型还清空了预算、删了"游戏"、清了约束 → 全部被守卫拦下
    expect(event.rejectedFields).toEqual(["budgetCents", "useCases", "constraints"]);
    expect(event.beforeIntent.budgetCents).toBe(2_000_000);
    expect(event.mergedIntent.budgetCents).toBe(2_000_000);
  });

  it("确定性预算指令：用户显式值优先于模型返回的不同数字", async () => {
    const created = await service.createDesignRequest({ rawInput: "2 万预算，剪辑和游戏" });
    // 模型这次返回预算 9000 元（漂移）；指令里明确"预算 8000" → 显式值赢
    const client = await import("@/infra/llm/client");
    vi.mocked(client.completeJson).mockImplementation(async (options: { system: string }) => {
      if (options.system.includes("方案调整器")) {
        return {
          ok: true as const,
          data: {
            budgetYuan: 9000,
            useCases: ["视频剪辑"],
            appearance: [],
            existingParts: [],
            constraints: [],
            region: "中国大陆",
          },
        };
      }
      return { ok: false as const, reason: "测试桩：其余模型路径禁用" };
    });

    const revised = await service.reviseDesign(created.request.id, { instruction: "预算 8000" });
    expect(revised.request.intent.budgetCents).toBe(800_000);
    const events = revisionMergedEvents(created.request.id);
    expect(events).toHaveLength(1);
    expect((events[0] as { changedFields: string[] }).changedFields).toEqual(["budgetCents"]);
    // 模型还顺手删了用途（"游戏"）和约束 → 一并被守卫拒绝
    expect((events[0] as { rejectedFields: string[] }).rejectedFields).toEqual([
      "budgetCents",
      "useCases",
      "constraints",
    ]);
    expect(revised.request.intent.useCases).toEqual(["视频剪辑", "游戏"]);
  });
});
