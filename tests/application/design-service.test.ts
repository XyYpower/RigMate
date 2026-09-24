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
});
