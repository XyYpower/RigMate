import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// 设计服务回归（M30）：确保 LLM 未配置时整条 目标→方案→接受 主链路行为与 M28 一致
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-design-service-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "design.db");
delete process.env.RIGMATE_LLM_API_KEY;

const service = await import("@/application/design/service");
const { closeDatabase } = await import("@/infra/db/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("设计服务（无 LLM 降级路径）", () => {
  it("创建目标：本地规则解析并生成方案，活动流如实标注模式", async () => {
    const result = await service.createDesignRequest({
      rawInput: "2 万预算，白色海景房，剪辑和游戏",
    });
    expect(result.proposal).not.toBeNull();
    expect(result.request.status).toBe("ready_to_review");
    expect(result.proposal?.items.length).toBeGreaterThanOrEqual(8);
    const note = result.run.events.find((e) => e.type === "understanding" && e.status === "completed");
    expect(note?.message).toContain("本地规则");
  });

  it("接受方案幂等：重复接受返回同一个正式项目", async () => {
    const created = await service.createDesignRequest({ rawInput: "8000 预算，玩游戏" });
    const proposalId = created.proposal!.id;
    const first = service.acceptDesignProposal(proposalId);
    const second = service.acceptDesignProposal(proposalId);
    expect(second.buildId).toBe(first.buildId);
  });

  it("修订：预算跨档位生成第 2 版并回写意图（规则路径，无 LLM）", async () => {
    const created = await service.createDesignRequest({ rawInput: "2 万预算，白色海景房，剪辑和游戏" });
    const revised = await service.reviseDesign(created.request.id, { instruction: "预算压到 1.2 万" });
    expect(revised.proposal?.version).toBe(2);
    expect(revised.proposal?.budgetCents).toBe(1_200_000);
    expect(revised.request.intent.budgetCents).toBe(1_200_000);
    const note = revised.run.events.find((e) => e.type === "understanding" && e.status === "completed");
    expect(note?.message).toContain("已理解调整");
    expect(revised.run.events.some((e) => e.message.includes("第 2 版"))).toBe(true);
    // 预算跌破档位线：显卡从 4070 SUPER 降到 4060，diff 应体现
    expect(revised.changes.some((change) => change.category === "gpu" && change.toLabel?.includes("RTX 4060"))).toBe(true);
  });

  it("修订：仅预算未跨档位时换件为空（诚实：没变化就不造变化）", async () => {
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
});
