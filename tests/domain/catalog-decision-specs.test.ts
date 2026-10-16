import { describe, expect, it } from "vitest";
import { DECISION_SPEC_FIELDS, decisionSpecsOf } from "@/domain/catalog/decision-specs";
import { rankCandidates, type RankedCandidate } from "@/domain/catalog/ranking";
import type { StructuredIntent } from "@/contracts/design";

// M2 Task 3：decisionSpecs 白名单（blueprint §6.2）。
// 模型只看决策字段——每类白名单必须覆盖规则引擎消费的全部字段（缺了会导致模型
// 无法解释规则结论），同时挡住无关字段（CPU 频率、营销文案）扩散进提示词。

const INTENT: StructuredIntent = {
  budgetCents: null,
  useCases: [],
  appearance: [],
  existingParts: [],
  constraints: [],
  region: "中国大陆",
};

function candidateOf(category: RankedCandidate["category"], spec: Record<string, unknown>): RankedCandidate {
  return { id: `${category}-1`, category, name: "测试件", aliases: [], spec, qualityStatus: "supported" };
}

describe("decisionSpecs 白名单", () => {
  it("每类白名单覆盖规则消费的字段", () => {
    expect(DECISION_SPEC_FIELDS.cpu).toEqual(
      expect.arrayContaining(["socket", "tdpWatts", "ptpMaxWatts", "hasIgpu", "m2Lanes"]),
    );
    expect(DECISION_SPEC_FIELDS.motherboard).toEqual(
      expect.arrayContaining([
        "socket",
        "formFactor",
        "ramType",
        "ramSlots",
        "m2Slots",
        "sataPorts",
        "pcieX16Slots",
        "targetCpuTdpWatts",
        "vrmScore",
      ]),
    );
    expect(DECISION_SPEC_FIELDS.gpu).toEqual(
      expect.arrayContaining(["tdpWatts", "pcie8pin", "twelveVhpwr", "lengthMm", "vramGb"]),
    );
    expect(DECISION_SPEC_FIELDS.psu).toEqual(expect.arrayContaining(["ratedWatts", "pcie8pin", "twelveVhpwr"]));
    expect(DECISION_SPEC_FIELDS.ram).toEqual(expect.arrayContaining(["ddrType", "sticks", "heightMm"]));
    expect(DECISION_SPEC_FIELDS.storage).toEqual(expect.arrayContaining(["interface"]));
    expect(DECISION_SPEC_FIELDS.cooler).toEqual(expect.arrayContaining(["socket", "supportedSockets", "heightMm", "memoryClearanceMm"]));
    expect(DECISION_SPEC_FIELDS.case).toEqual(
      expect.arrayContaining(["supportedFormFactors", "maxGpuLengthMm", "maxCoolerHeightMm"]),
    );
    // 档位是模型做取舍解释的公共上下文
    for (const fields of Object.values(DECISION_SPEC_FIELDS)) {
      expect(fields).toContain("tier");
    }
  });

  it("decisionSpecsOf 只保留白名单内且非空的键", () => {
    const filtered = decisionSpecsOf("cpu", {
      socket: "AM5",
      tdpWatts: 120,
      boostClockGHz: 5.2,
      marketingNote: "旗舰",
      hasIgpu: null,
    });
    expect(filtered).toEqual({ socket: "AM5", tdpWatts: 120 });
  });

  it("rankCandidates 产出的摘要带 decisionSpecs（子集校验）", () => {
    const [summary] = rankCandidates(
      [
        candidateOf("gpu", {
          tdpWatts: 220,
          pcie8pin: 0,
          twelveVhpwr: 1,
          lengthMm: 310,
          vramGb: 12,
          tier: 7,
          boostClockGHz: 2.6,
        }),
      ],
      INTENT,
    );
    expect(summary?.decisionSpecs).toEqual({
      tdpWatts: 220,
      pcie8pin: 0,
      twelveVhpwr: 1,
      lengthMm: 310,
      vramGb: 12,
      tier: 7,
    });
  });
});
