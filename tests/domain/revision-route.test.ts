import { describe, expect, it } from "vitest";
import { classifyRevision } from "@/domain/design/revision-route";

// M3 修订快速路由（blueprint §2 §8.1）：每轮修订先过确定性分类器——
// 规则能处理的不调模型（省钱省时），说明类问题不重新生成方案，其余才进 LLM。

describe("classifyRevision（修订路由）", () => {
  it("预算类指令 → rules（确定性解析器覆盖）", () => {
    expect(classifyRevision("预算压到 8000")).toBe("rules");
    expect(classifyRevision("预算控制在 1.5 万")).toBe("rules");
  });

  it("已有硬件类指令 → rules", () => {
    expect(classifyRevision("我已有电源")).toBe("rules");
    expect(classifyRevision("机箱保留，不用配")).toBe("rules");
  });

  it("说明类问题 → question（不重新生成方案）", () => {
    expect(classifyRevision("为什么选这个显卡？")).toBe("question");
    expect(classifyRevision("这套配置的依据是什么")).toBe("question");
    expect(classifyRevision("电源为啥选 850W")).toBe("question");
  });

  it("其余修改诉求 → llm", () => {
    expect(classifyRevision("换成白色海景房机箱")).toBe("llm");
    expect(classifyRevision("安静一点，预算可以加一点")).toBe("llm");
    // 含问号但带修改动词的仍是修改诉求
    expect(classifyRevision("机箱能不能换白色的？")).toBe("llm");
  });
});
