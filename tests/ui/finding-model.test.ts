import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_LABEL,
  STATUS_META,
  STATUS_ORDER,
  toFindingCardModel,
} from "@/ui/finding-model";
import type { Finding, FindingStatus } from "@/domain/build/types";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "R-TEST-001",
    status: "pass",
    itemIds: [],
    conclusion: "插槽一致",
    evidence: ["CPU 插槽 LGA1851", "主板插槽 LGA1851"],
    dataDate: null,
    confidence: "high",
    assumptions: [],
    missingFields: [],
    suggestedAction: "可以继续",
    ...overrides,
  };
}

describe("STATUS_META 语义视觉映射", () => {
  it("覆盖领域层全部五种结论状态", () => {
    const allStatuses: FindingStatus[] = [
      "pass",
      "block",
      "warn",
      "unknown",
      "not_applicable",
    ];
    for (const status of allStatuses) {
      expect(STATUS_META[status], `缺少状态 ${status} 的映射`).toBeDefined();
    }
  });

  it("unknown 使用虚线幽灵视觉，其余为实线", () => {
    expect(STATUS_META.unknown.borderStyle).toBe("dashed");
    expect(STATUS_META.pass.borderStyle).toBe("solid");
    expect(STATUS_META.block.borderStyle).toBe("solid");
    expect(STATUS_META.warn.borderStyle).toBe("solid");
    expect(STATUS_META.not_applicable.borderStyle).toBe("solid");
  });

  it("报告排序符合业务规格 §9.4 优先级", () => {
    expect(STATUS_ORDER).toEqual(["block", "unknown", "warn", "pass", "not_applicable"]);
  });
});

describe("CONFIDENCE_LABEL 置信度三档", () => {
  it("high/medium/low 映射为 高/中/低", () => {
    expect(CONFIDENCE_LABEL.high).toBe("高");
    expect(CONFIDENCE_LABEL.medium).toBe("中");
    expect(CONFIDENCE_LABEL.low).toBe("低");
  });
});

describe("toFindingCardModel 六要素视图模型", () => {
  it("完整映射六要素：结论/证据/数据日期/置信度/假设条件/建议动作", () => {
    const model = toFindingCardModel(
      makeFinding({
        status: "block",
        ruleId: "R-PSU-001",
        conclusion: "电源额定功率不足",
        evidence: ["估算整机功耗 620W", "电源额定 550W"],
        dataDate: "2026-09-20",
        confidence: "medium",
        assumptions: ["按 CPU TDP + GPU TDP 估算"],
        suggestedAction: "更换 750W 及以上电源",
      }),
    );

    expect(model.ruleId).toBe("R-PSU-001");
    expect(model.status).toBe("block");
    expect(model.statusLabel).toBe("阻断");
    expect(model.conclusion).toBe("电源额定功率不足");
    expect(model.evidenceLines).toHaveLength(2);
    expect(model.dataDate).toBe("2026-09-20");
    expect(model.confidenceLabel).toBe("中");
    expect(model.assumptions).toEqual(["按 CPU TDP + GPU TDP 估算"]);
    expect(model.suggestedAction).toBe("更换 750W 及以上电源");
  });

  it("dataDate 缺失时保留 null，由展示层输出'未记录'", () => {
    const model = toFindingCardModel(makeFinding({ dataDate: null }));
    expect(model.dataDate).toBeNull();
  });

  it("待补充字段与视觉透传不丢失", () => {
    const model = toFindingCardModel(
      makeFinding({ status: "unknown", missingFields: ["gpu.lengthMm", "case.maxGpuLengthMm"] }),
    );
    expect(model.missingFields).toEqual(["gpu.lengthMm", "case.maxGpuLengthMm"]);
    expect(model.accentBorderStyle).toBe("dashed");
  });
});
