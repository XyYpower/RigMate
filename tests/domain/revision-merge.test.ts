import { describe, expect, it } from "vitest";
import {
  mergeRevisionIntent,
  revisionTouchedFields,
} from "@/domain/design/revision-merge";
import type { StructuredIntent } from "@/contracts/design";

// M1 修订合并守卫（blueprint §3.2/§3.3）：模型每轮返回完整意图，
// 服务端只接受「用户明确触及的字段」变化——模型不能因为用户说"换白色显卡"
// 而清空预算、用途或已有硬件。字段来源优先级：当前轮用户显式 > 模型解析 > before。

function intentOf(overrides: Partial<StructuredIntent> = {}): StructuredIntent {
  return {
    budgetCents: 1_500_000,
    useCases: ["游戏", "视频剪辑"],
    appearance: ["静音"],
    existingParts: [],
    constraints: ["优先安静"],
    region: "中国大陆",
    ...overrides,
  };
}

describe("revisionTouchedFields（指令触达字段识别）", () => {
  it("识别六类字段的触达", () => {
    expect(revisionTouchedFields("预算压到 1.2 万")).toEqual(["budgetCents"]);
    expect(revisionTouchedFields("机箱要白色海景房")).toEqual(["appearance"]);
    expect(revisionTouchedFields("我已有电源，不用配了")).toEqual(["existingParts"]);
    expect(revisionTouchedFields("主要剪视频，偶尔打游戏")).toEqual(["useCases"]);
    expect(revisionTouchedFields("不要水冷")).toEqual(["constraints"]);
    expect(revisionTouchedFields("人在大陆，国行件")).toEqual(["region"]);
  });

  it("一条指令可同时触达多个字段；无关指令触达为空", () => {
    expect(revisionTouchedFields("预算 8000，主要玩游戏").sort()).toEqual([
      "budgetCents",
      "useCases",
    ]);
    expect(revisionTouchedFields("帮我看看")).toEqual([]);
  });
});

describe("mergeRevisionIntent（只接受明确触及的字段变化）", () => {
  it("触及的预算改动被接受", () => {
    const result = mergeRevisionIntent({
      before: intentOf(),
      instruction: "预算压到 1.2 万",
      modelIntent: intentOf({ budgetCents: 1_200_000 }),
    });
    expect(result.intent.budgetCents).toBe(1_200_000);
    expect(result.changedFields).toEqual(["budgetCents"]);
    expect(result.rejectedFields).toEqual([]);
  });

  it("模型擅自清空未触及字段（预算）→ 拒绝并保留 before 值", () => {
    const result = mergeRevisionIntent({
      before: intentOf(),
      instruction: "机箱要白色海景房",
      modelIntent: intentOf({ appearance: ["白色", "海景房"], budgetCents: null }),
    });
    expect(result.intent.budgetCents).toBe(1_500_000);
    expect(result.intent.appearance).toEqual(["白色", "海景房"]);
    expect(result.changedFields).toEqual(["appearance"]);
    expect(result.rejectedFields).toEqual(["budgetCents"]);
  });

  it("用户显式预算优先于模型解析（来源优先级第 1 > 第 3）", () => {
    const result = mergeRevisionIntent({
      before: intentOf(),
      instruction: "预算 8000",
      modelIntent: intentOf({ budgetCents: 900_000 }),
    });
    expect(result.intent.budgetCents).toBe(800_000);
    expect(result.changedFields).toEqual(["budgetCents"]);
    expect(result.rejectedFields).toEqual(["budgetCents"]);
  });

  it("模型与 before 全等：两个列表皆空，不动任何字段", () => {
    const before = intentOf();
    const result = mergeRevisionIntent({ before, instruction: "帮我看看", modelIntent: before });
    expect(result.changedFields).toEqual([]);
    expect(result.rejectedFields).toEqual([]);
    expect(result.intent).toEqual(before);
  });

  it("未触及字段的数组内容被模型改动 → 整体拒绝（不做部分合并）", () => {
    const result = mergeRevisionIntent({
      before: intentOf(),
      instruction: "预算压到 1.2 万",
      modelIntent: intentOf({
        budgetCents: 1_200_000,
        useCases: ["办公"],
      }),
    });
    expect(result.intent.useCases).toEqual(["游戏", "视频剪辑"]);
    expect(result.rejectedFields).toContain("useCases");
    expect(result.intent.budgetCents).toBe(1_200_000);
  });

  it("不修改入参对象（before 与 modelIntent 保持原样）", () => {
    const before = intentOf();
    const model = intentOf({ budgetCents: null });
    mergeRevisionIntent({ before, instruction: "机箱要白色", modelIntent: model });
    expect(before.budgetCents).toBe(1_500_000);
    expect(model.budgetCents).toBeNull();
  });
});
