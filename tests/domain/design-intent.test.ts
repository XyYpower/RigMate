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
