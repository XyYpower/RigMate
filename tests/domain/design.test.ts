import { describe, expect, it } from "vitest";
import { parseDesignIntent, designTitle, intentNeedsInput } from "@/domain/design/intent";
import { generateDesignProposal } from "@/domain/design/proposal";
import { CATALOG } from "@/domain/catalog/seed";

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

describe("规则式方案生成垂直切片", () => {
  it("从目录生成八类候选并附自动校验摘要", () => {
    const result = generateDesignProposal({
      requestId: "00000000-0000-4000-8000-000000000000",
      intent: parseDesignIntent({ rawInput: "2 万预算，白色海景房，剪辑和游戏" }),
      entries: CATALOG,
    });
    expect(result.proposal.items.length).toBeGreaterThanOrEqual(8);
    expect(result.proposal.items.some((item) => item.category === "gpu")).toBe(true);
    expect(result.proposal.estimatedLowCents).toBeGreaterThan(0);
    expect(["ok", "attention", "unknown", "conflict"]).toContain(result.proposal.compatibility.status);
    expect(result.proposal.unknowns.length).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("预算档位真实影响候选选择与取舍说明", () => {
    const high = generateDesignProposal({
      requestId: "00000000-0000-4000-8000-000000000001",
      intent: parseDesignIntent({ rawInput: "2 万预算，剪辑和游戏" }),
      entries: CATALOG,
    });
    const low = generateDesignProposal({
      requestId: "00000000-0000-4000-8000-000000000002",
      intent: parseDesignIntent({ rawInput: "8 千预算，玩游戏" }),
      entries: CATALOG,
    });
    const highGpu = high.proposal.items.find((item) => item.category === "gpu");
    const lowGpu = low.proposal.items.find((item) => item.category === "gpu");
    expect(highGpu?.label).toContain("4070 SUPER");
    expect(lowGpu?.label).toContain("RTX 4060");
    expect(high.proposal.fitNotes.some((note) => note.includes("预算"))).toBe(true);
    expect(low.proposal.fitNotes.some((note) => note.includes("预算"))).toBe(true);
  });
});
