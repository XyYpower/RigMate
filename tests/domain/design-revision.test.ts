import { describe, expect, it } from "vitest";
import { existingPartCategories, parseBudgetRevision, reviseIntentWithRules } from "@/domain/design/revision";
import { parseDesignIntent } from "@/domain/design/intent";

describe("已有硬件类别识别", () => {
  it("识别电源与显卡，忽略不认识的描述", () => {
    expect(existingPartCategories(["电源", "旧显卡", "一把电竞椅"])).toEqual(["psu", "gpu"]);
  });

  it("重复类别只保留一个", () => {
    expect(existingPartCategories(["已有电源", "金牌电源"])).toEqual(["psu"]);
  });
});

describe("预算修订解析", () => {
  it("支持 压到/控制在/万/千/元 等表达", () => {
    expect(parseBudgetRevision("预算压到 1.8 万")).toBe(18000);
    expect(parseBudgetRevision("控制在 18000")).toBe(18000);
    expect(parseBudgetRevision("预算 8千")).toBe(8000);
    expect(parseBudgetRevision("预算改成 6500 元")).toBe(6500);
    expect(parseBudgetRevision("预算 2w")).toBe(20000);
  });

  it("无单位的歧义数字不猜（如 预算 1.5）", () => {
    expect(parseBudgetRevision("预算 1.5")).toBeNull();
    expect(parseBudgetRevision("显卡换白色")).toBeNull();
  });
});

describe("规则式意图修订", () => {
  it("预算调整更新意图（分）并给出变更说明", () => {
    const base = parseDesignIntent({ rawInput: "2 万预算，剪辑和游戏" });
    const result = reviseIntentWithRules(base, "预算压到 1.8 万");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.budgetCents).toBe(1_800_000);
      expect(result.changes[0]).toContain("18,000");
    }
  });

  it("已有硬件写回意图且可推导排除类别", () => {
    const base = parseDesignIntent({ rawInput: "2 万预算，剪辑和游戏" });
    const result = reviseIntentWithRules(base, "我已有电源，预算压到 1.8 万");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.budgetCents).toBe(1_800_000);
      expect(result.intent.existingParts.join()).toContain("电源");
      expect(existingPartCategories(result.intent.existingParts)).toContain("psu");
    }
  });

  it("理解不了的指令如实失败，不硬猜", () => {
    const base = parseDesignIntent({ rawInput: "2 万预算，剪辑和游戏" });
    expect(reviseIntentWithRules(base, "帮我随便改改").ok).toBe(false);
    expect(reviseIntentWithRules(base, "显卡换白色").ok).toBe(false);
  });
});
