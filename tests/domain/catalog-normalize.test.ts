import { describe, expect, it } from "vitest";
import { aliasMatchBlockedByVariantTail, modelPhrases, modelTokens, normalizeModelText } from "@/domain/catalog/normalize";

// M2 Task 1：型号文本规范化（launch-readiness §6.1 召回顺序第一步）。
// 目标：同一型号在不同写法下规范化结果一致——大小写、全角、空格/连字符、括号注记。

describe("normalizeModelText", () => {
  it("大小写与空格归一", () => {
    expect(normalizeModelText("AMD Ryzen 7 9800X3D")).toBe("amdryzen79800x3d");
    expect(normalizeModelText("rtx 4070 super")).toBe(normalizeModelText("RTX 4070 SUPER"));
  });

  it("连字符与点不参与比较", () => {
    expect(normalizeModelText("TUF GAMING B850-PLUS WIFI")).toBe("tufgamingb850pluswifi");
    expect(normalizeModelText("Ryzen 5 7500F")).toBe(normalizeModelText("ryzen5.7500f"));
  });

  it("全角字符转半角", () => {
    expect(normalizeModelText("ＲＴＸ４０７０")).toBe("rtx4070");
    expect(normalizeModelText("ＧＢ")).toBe("gb");
  });

  it("剥离括号注记（真实目录的脏尾巴）", () => {
    expect(normalizeModelText("AMD RX 7600（参考规格）")).toBe("amdrx7600");
    expect(normalizeModelText("RTX 4060 (参考规格)")).toBe("rtx4060");
    expect(normalizeModelText("锐龙 7 9800X3D（8 核 16 线程）")).toBe("锐龙79800x3d");
  });

  it("中文保留（中文名可直接比较）", () => {
    expect(normalizeModelText("小雕 B850M")).toBe("小雕b850m");
  });
});

describe("modelTokens / modelPhrases", () => {
  it("抽取字母数字 token，中文当分隔符", () => {
    expect(modelTokens("预算9800X3D 处理器")).toEqual(["9800x3d"]);
    expect(modelTokens("B850M 小雕")).toEqual(["b850m"]);
  });

  it("modelPhrases 抽取字母数字 run，中文是天然边界", () => {
    expect(modelPhrases("预算 1.5 万，换成 4070S")).toEqual(["4070s"]);
    expect(modelPhrases("我已有 7950X3D 和 850W 金牌")).toEqual(["7950x3d", "850w"]);
    expect(modelPhrases("cpu 就用 9800X3D，打网游为主")).toEqual(["9800x3d"]);
    // 带内部空格的型号保持完整 run
    expect(modelPhrases("换成 r7 9800x3d")).toEqual(["r7 9800x3d"]);
    // 纯数字或纯字母段不是型号短语
    expect(modelPhrases("预算压到 1.2 万")).toEqual([]);
    expect(modelPhrases("cpu 就用 intel 的")).toEqual([]);
  });
});


describe("aliasMatchBlockedByVariantTail（型号变体消歧，M3）", () => {
  it("命中点尾部是变体 token → 拒绝（5090 Ti ≠ 5090）", () => {
    expect(aliasMatchBlockedByVariantTail("5090", "rtx5090ti")).toBe(true);
    expect(aliasMatchBlockedByVariantTail("4070", "rtx4070super")).toBe(true);
    expect(aliasMatchBlockedByVariantTail("7900", "7900xtx")).toBe(true);
  });

  it("错字与规格后缀不受影响", () => {
    // 错字尾部不在词表：保留命中（typo 评测用例依赖）
    expect(aliasMatchBlockedByVariantTail("4070s", "4070suer")).toBe(false);
    // 数字开头的规格尾巴（32g）不是变体 token
    expect(aliasMatchBlockedByVariantTail("光威龙武6000", "光威龙武600032g")).toBe(false);
    // 命中到串尾：无尾部
    expect(aliasMatchBlockedByVariantTail("5090", "rtx5090")).toBe(false);
  });
});
