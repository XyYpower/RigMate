import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// 设计服务回归（内核恢复计划）：无 LLM 时 目标→质量门候选→证据价格方案→接受 全链路。
// 临时库先种 fixture 池（supported + 已审核价格），否则质量门后没有候选，属诚实空态。
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-design-service-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "design.db");
delete process.env.RIGMATE_LLM_API_KEY;

const { seedCatalogFixtureIntoDb } = await import("@/infra/catalog-import/fixture");
seedCatalogFixtureIntoDb();

const service = await import("@/application/design/service");
const { closeDatabase } = await import("@/infra/db/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("设计服务（无 LLM 降级路径）", () => {
  it("创建目标：本地规则解析 + 质量门候选生成方案，活动流如实标注模式", async () => {
    const result = await service.createDesignRequest({
      rawInput: "2 万预算，白色海景房，剪辑和游戏",
    });
    expect(result.proposal).not.toBeNull();
    expect(result.request.status).toBe("ready_to_review");
    // fixture 八类齐全（gpu 两档、psu 两档 → 仍是一类一件）
    expect(result.proposal?.items.length).toBe(8);
    for (const item of result.proposal?.items ?? []) {
      expect(item.sourceLevel).toBe("supported_catalog");
      expect(item.priceBasis).toBe("evidence");
    }
    const retrieving = result.run.events.find((e) => e.type === "retrieving" && e.status === "completed");
    expect(retrieving?.message).toContain("质量门");
    const note = result.run.events.find((e) => e.type === "understanding" && e.status === "completed");
    expect(note?.message).toContain("本地规则");
  });

  it("接受方案幂等：重复接受返回同一个正式项目，且字段质量层随件下传", async () => {
    const created = await service.createDesignRequest({ rawInput: "8000 预算，玩游戏" });
    const proposalId = created.proposal!.id;
    const first = service.acceptDesignProposal(proposalId);
    const second = service.acceptDesignProposal(proposalId);
    expect(second.buildId).toBe(first.buildId);
    // fixture 无字段证据 → 质量层为空 = 无质量层（规则按历史行为处理）
    expect(first.build?.items.length ?? 0).toBeGreaterThan(0);
  });

  it("修订：预算低于高档已审核价格时显卡降档并生成第 2 版（规则路径，无 LLM）", async () => {
    const created = await service.createDesignRequest({ rawInput: "2 万预算，白色海景房，剪辑和游戏" });
    // 4070S 已审核价 ¥4,999 > ¥4,000 → 超支强惩罚；4060 ¥2,399 在预算内 → 排序第一
    const revised = await service.reviseDesign(created.request.id, { instruction: "预算压到 4000" });
    expect(revised.proposal?.version).toBe(2);
    expect(revised.proposal?.budgetCents).toBe(400_000);
    expect(revised.request.intent.budgetCents).toBe(400_000);
    const note = revised.run.events.find((e) => e.type === "understanding" && e.status === "completed");
    expect(note?.message).toContain("已理解调整");
    expect(revised.run.events.some((e) => e.message.includes("第 2 版"))).toBe(true);
    expect(revised.changes.some((change) => change.category === "gpu" && change.toLabel?.includes("RTX 4060"))).toBe(true);
  });

  it("修订：预算未触及任何候选价格时换件为空（诚实：没变化就不造变化）", async () => {
    const created = await service.createDesignRequest({ rawInput: "2 万预算，剪辑和游戏" });
    const revised = await service.reviseDesign(created.request.id, { instruction: "预算压到 1.8 万" });
    expect(revised.proposal?.version).toBe(2);
    expect(revised.changes).toEqual([]);
  });

  it("修订：无法理解时保留原方案并诚实追问", async () => {
    const created = await service.createDesignRequest({ rawInput: "8000 预算，玩游戏" });
    const result = await service.reviseDesign(created.request.id, { instruction: "帮我随便改改" });
    expect(result.proposal?.version).toBe(1);
    expect(result.changes).toEqual([]);
    const question = result.run.events.find((e) => e.type === "question");
    expect(question?.message).toContain("我没能理解这条调整");
    expect(question?.message).toContain("未配置大模型");
  });

  it("修订：已有硬件类别不再生成购置候选，diff 标记不再购置", async () => {
    const created = await service.createDesignRequest({ rawInput: "2 万预算，剪辑和游戏" });
    const revised = await service.reviseDesign(created.request.id, { instruction: "我已有电源" });
    expect(revised.proposal?.version).toBe(2);
    expect(revised.proposal?.items.some((item) => item.category === "psu")).toBe(false);
    expect(revised.proposal?.fitNotes.some((note) => note.includes("已有硬件"))).toBe(true);
    expect(revised.changes).toContainEqual({
      category: "psu",
      fromLabel: expect.stringContaining("TUF"),
      toLabel: null,
    });
  });

  it("候选池为空的数据库：诚实追问而不是硬凑方案", async () => {
    // fixture 之外另开一个空库：质量门后无候选 → question 运行 + proposal null
    const emptyDir = mkdtempSync(join(tmpdir(), "rigmate-design-empty-"));
    const previousPath = process.env.RIGMATE_DB_PATH;
    const { closeDatabase: closeCurrent } = await import("@/infra/db/client");
    closeCurrent();
    process.env.RIGMATE_DB_PATH = join(emptyDir, "empty.db");
    const { resetCatalogDbCacheForTests } = await import("@/infra/db/repositories/catalog-repository");
    const { resetBuildcoresCatalogCacheForTests } = await import("@/infra/catalog-import/load");
    resetCatalogDbCacheForTests();
    resetBuildcoresCatalogCacheForTests();
    try {
      const result = await service.createDesignRequest({ rawInput: "2 万预算，剪辑和游戏" });
      expect(result.proposal).toBeNull();
      const question = result.run.events.find((e) => e.type === "question");
      expect(question?.message).toContain("质量门");
    } finally {
      closeCurrent();
      process.env.RIGMATE_DB_PATH = previousPath;
      resetCatalogDbCacheForTests();
      // 重新打开主临时库
      seedCatalogFixtureIntoDb();
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
