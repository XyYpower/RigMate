import { describe, expect, it } from "vitest";
import { parseDesignIntent, intentNeedsInput } from "@/domain/design/intent";

// M5 意图解析回归：歧义预算不猜（"预算 1.5"曾静默错判成 ¥1.5）；无单位 ≥1000 才认元。

describe("parseDesignIntent 预算歧义守卫", () => {
  it("无单位小数（预算 1.5）→ 不识别为预算，进入追问", () => {
    const intent = parseDesignIntent({ rawInput: "预算 1.5" });
    expect(intent.budgetCents).toBeNull();
    expect(intentNeedsInput(intent)).toBe(true);
  });

  it("无单位整数 ≥1000 认元（8000 预算）", () => {
    expect(parseDesignIntent({ rawInput: "预算 8000" }).budgetCents).toBe(800_000);
  });

  it("带单位照常换算", () => {
    expect(parseDesignIntent({ rawInput: "预算 1.5 万" }).budgetCents).toBe(1_500_000);
    expect(parseDesignIntent({ rawInput: "8000 元" }).budgetCents).toBe(800_000);
  });
});

describe("规则降级四缺口（M5 评测驱动，Phase 5 修复）", () => {
  it("中文数字：预算两万", () => {
    const intent = parseDesignIntent({ rawInput: "预算两万，打游戏" });
    expect(intent.budgetCents).toBe(2_000_000);
    expect(intent.useCases).toContain("游戏");
  });

  it("万位尾数：2 万 5 / 2万5", () => {
    expect(parseDesignIntent({ rawInput: "预算 2 万 5，开发用" }).budgetCents).toBe(2_500_000);
    expect(parseDesignIntent({ rawInput: "2万5 打游戏" }).budgetCents).toBe(2_500_000);
  });

  it("口语填充词：大概 / 左右 / 以内", () => {
    expect(parseDesignIntent({ rawInput: "预算大概 8000 左右吧" }).budgetCents).toBe(800_000);
    expect(parseDesignIntent({ rawInput: "预算 1 万以内" }).budgetCents).toBe(1_000_000);
  });

  it("已有件后置语序：机箱保留 / 显卡继续用", () => {
    const intent = parseDesignIntent({ rawInput: "8000，机箱保留用旧的" });
    expect(intent.existingParts.some((part) => part.includes("机箱"))).toBe(true);
    const intent2 = parseDesignIntent({ rawInput: "预算 2 万，显卡继续用" });
    expect(intent2.existingParts.some((part) => part.includes("显卡"))).toBe(true);
  });
});
