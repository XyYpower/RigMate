import { describe, expect, it } from "vitest";
import { modelPhrases, modelTokens, normalizeModelText } from "@/domain/catalog/normalize";

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

  it("modelPhrases 抽取含字母+数字的短语（候选型号句）", () => {
    expect(modelPhrases("预算 1.5 万，换成 4070S")).toEqual(["换成 4070S"]);
    expect(modelPhrases("我已有 7950X3D 和 850W 金牌")).toEqual(["我已有 7950X3D 和 850W 金牌"]);
    // 纯数字或纯中文段不是型号短语
    expect(modelPhrases("预算压到 1.2 万")).toEqual([]);
  });
});
