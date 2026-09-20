import { describe, expect, it } from "vitest";
import { runBuildChecks } from "@/domain/rules/engine";
import { makeItem } from "./cpu-motherboard.test";

describe("R-MB-GPU-001 主板 PCIe x16 插槽", () => {
  it("有 x16 插槽通过", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { pcieX16Slots: 1 } }),
      makeItem({ category: "gpu", spec: {} }),
    ])[0];
    expect(finding?.ruleId).toBe("R-MB-GPU-001");
    expect(finding?.status).toBe("pass");
  });

  it("没有 x16 插槽阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { pcieX16Slots: 0 } }),
      makeItem({ category: "gpu", spec: {} }),
    ])[0];
    expect(finding?.status).toBe("block");
  });

  it("插槽数缺失时未知", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: {} }),
      makeItem({ category: "gpu", spec: {} }),
    ])[0];
    expect(finding?.status).toBe("unknown");
  });
});

describe("R-MB-RAM-001 内存代际", () => {
  const motherboard = { category: "motherboard" as const, spec: { ramType: "DDR5" as const } };

  it("代际一致通过", () => {
    const finding = runBuildChecks([
      makeItem(motherboard),
      makeItem({ category: "ram", spec: { ddrType: "DDR5" } }),
    ]).find((f) => f.ruleId === "R-MB-RAM-001");
    expect(finding?.status).toBe("pass");
  });

  it("代际冲突阻断", () => {
    const finding = runBuildChecks([
      makeItem(motherboard),
      makeItem({ category: "ram", label: "金士顿 16G", spec: { ddrType: "DDR4" } }),
    ])[0];
    expect(finding?.ruleId).toBe("R-MB-RAM-001");
    expect(finding?.status).toBe("block");
    expect(finding?.conclusion).toContain("DDR4");
  });

  it("主板或内存代际缺失时未知", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: {} }),
      makeItem({ category: "ram", spec: { ddrType: "DDR4" } }),
    ])[0];
    expect(finding?.status).toBe("unknown");
    expect(finding?.missingFields).toContain("主板内存代际");
  });
});

describe("R-RAM-001 内存条数与插槽数", () => {
  it("总条数超过插槽数阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { ramSlots: 2 } }),
      makeItem({ category: "ram", spec: { sticks: 2 } }),
      makeItem({ category: "ram", spec: { sticks: 2 } }),
    ])[0];
    expect(finding?.ruleId).toBe("R-RAM-001");
    expect(finding?.status).toBe("block");
  });

  it("单条内存不警告", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { ramSlots: 4 } }),
      makeItem({ category: "ram", spec: { sticks: 1 } }),
    ]).find((f) => f.ruleId === "R-RAM-001");
    expect(finding?.status).toBe("pass");
    expect(finding?.assumptions.join()).toContain("双通道");
  });

  it("插槽数缺失时未知", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: {} }),
      makeItem({ category: "ram", spec: { sticks: 2 } }),
    ])[0];
    expect(finding?.status).toBe("unknown");
  });
});

describe("R-MB-CASE-001 主板板型与机箱", () => {
  it("板型不被机箱支持时阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { formFactor: "ATX" } }),
      makeItem({ category: "case", spec: { supportedFormFactors: ["mATX", "ITX"] } }),
    ])[0];
    expect(finding?.ruleId).toBe("R-MB-CASE-001");
    expect(finding?.status).toBe("block");
  });

  it("板型受支持时通过", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { formFactor: "mATX" } }),
      makeItem({ category: "case", spec: { supportedFormFactors: ["mATX", "ITX"] } }),
    ])[0];
    expect(finding?.status).toBe("pass");
  });

  it("机箱支持列表缺失时未知", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { formFactor: "mATX" } }),
      makeItem({ category: "case", spec: {} }),
    ])[0];
    expect(finding?.status).toBe("unknown");
  });
});

describe("R-GPU-CASE-001 显卡长度与机箱限长", () => {
  it("超长阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "gpu", spec: { lengthMm: 336 } }),
      makeItem({ category: "case", spec: { maxGpuLengthMm: 330 } }),
    ])[0];
    expect(finding?.ruleId).toBe("R-GPU-CASE-001");
    expect(finding?.status).toBe("block");
  });

  it("长度恰好等于限长时通过并提示公差", () => {
    const finding = runBuildChecks([
      makeItem({ category: "gpu", spec: { lengthMm: 330 } }),
      makeItem({ category: "case", spec: { maxGpuLengthMm: 330 } }),
    ])[0];
    expect(finding?.status).toBe("pass");
    expect(finding?.assumptions.join()).toContain("公差");
  });

  it("限长缺失时未知", () => {
    const finding = runBuildChecks([
      makeItem({ category: "gpu", spec: { lengthMm: 300 } }),
      makeItem({ category: "case", spec: {} }),
    ])[0];
    expect(finding?.status).toBe("unknown");
  });
});

describe("R-COOLER-CASE-001 散热器高度与机箱限高", () => {
  it("超高阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "cooler", spec: { heightMm: 165 } }),
      makeItem({ category: "case", spec: { maxCoolerHeightMm: 158 } }),
    ])[0];
    expect(finding?.ruleId).toBe("R-COOLER-CASE-001");
    expect(finding?.status).toBe("block");
  });

  it("高度等于限高时通过", () => {
    const finding = runBuildChecks([
      makeItem({ category: "cooler", spec: { heightMm: 158 } }),
      makeItem({ category: "case", spec: { maxCoolerHeightMm: 158 } }),
    ])[0];
    expect(finding?.status).toBe("pass");
  });
});

describe("R-PSU-001 整机功耗估算", () => {
  it("需求超过额定功率阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "cpu", spec: { tdpWatts: 170 } }),
      makeItem({ category: "gpu", spec: { tdpWatts: 450 } }),
      makeItem({ category: "psu", spec: { ratedWatts: 650 } }),
    ]).find((f) => f.ruleId === "R-PSU-001");
    expect(finding?.status).toBe("block");
    expect(finding?.conclusion).toContain("700");
  });

  it("余量不足 20% 时警告并展示假设", () => {
    const finding = runBuildChecks([
      makeItem({ category: "cpu", spec: { tdpWatts: 120 } }),
      makeItem({ category: "gpu", spec: { tdpWatts: 300 } }),
      makeItem({ category: "psu", spec: { ratedWatts: 600 } }),
    ]).find((f) => f.ruleId === "R-PSU-001");
    expect(finding?.status).toBe("warn");
    expect(finding?.assumptions.join()).toContain("80W");
  });

  it("余量充足时通过", () => {
    const finding = runBuildChecks([
      makeItem({ category: "cpu", spec: { tdpWatts: 65 } }),
      makeItem({ category: "gpu", spec: { tdpWatts: 160 } }),
      makeItem({ category: "psu", spec: { ratedWatts: 750 } }),
    ]).find((f) => f.ruleId === "R-PSU-001");
    expect(finding?.status).toBe("pass");
  });

  it("缺少 TDP 或额定功率时未知，不猜测", () => {
    const finding = runBuildChecks([
      makeItem({ category: "cpu", spec: { tdpWatts: 65 } }),
      makeItem({ category: "gpu", spec: {} }),
      makeItem({ category: "psu", spec: { ratedWatts: 750 } }),
    ]).find((f) => f.ruleId === "R-PSU-001");
    expect(finding?.status).toBe("unknown");
    expect(finding?.missingFields).toContain("显卡 TDP 功耗");
  });
});

describe("R-PSU-002 供电接口", () => {
  it("接口不足时阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "gpu", spec: { twelveVhpwr: 1 } }),
      makeItem({ category: "psu", spec: { pcie8pin: 2 } }),
    ])[0];
    expect(finding?.ruleId).toBe("R-PSU-002");
    expect(finding?.status).toBe("block");
  });

  it("接口满足时通过", () => {
    const finding = runBuildChecks([
      makeItem({ category: "gpu", spec: { pcie8pin: 1, twelveVhpwr: 0 } }),
      makeItem({ category: "psu", spec: { pcie8pin: 2, twelveVhpwr: 1 } }),
    ]).find((f) => f.ruleId === "R-PSU-002");
    expect(finding?.status).toBe("pass");
  });

  it("双方接口信息缺失时未知", () => {
    const finding = runBuildChecks([
      makeItem({ category: "gpu", spec: {} }),
      makeItem({ category: "psu", spec: {} }),
    ]).find((f) => f.ruleId === "R-PSU-002");
    expect(finding?.status).toBe("unknown");
    expect(finding?.missingFields).toEqual(["显卡供电接口", "电源供电接口"]);
  });
});

describe("R-COOLER-001 散热器插槽", () => {
  it("插槽不在支持列表时阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "cpu", spec: { socket: "AM5" } }),
      makeItem({ category: "cooler", spec: { supportedSockets: ["LGA1700", "LGA1851"] } }),
    ])[0];
    expect(finding?.ruleId).toBe("R-COOLER-001");
    expect(finding?.status).toBe("block");
  });

  it("插槽受支持时通过", () => {
    const finding = runBuildChecks([
      makeItem({ category: "cpu", spec: { socket: "AM5" } }),
      makeItem({ category: "cooler", spec: { supportedSockets: ["AM5", "AM4"] } }),
    ])[0];
    expect(finding?.status).toBe("pass");
  });
});

describe("R-STORAGE-001 存储接口", () => {
  it("主板没有 M.2 却选 NVMe 时阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { m2Slots: 0 } }),
      makeItem({ category: "storage", spec: { interface: "m2_nvme" } }),
    ])[0];
    expect(finding?.ruleId).toBe("R-STORAGE-001");
    expect(finding?.status).toBe("block");
  });

  it("接口与插槽匹配时通过", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { m2Slots: 2 } }),
      makeItem({ category: "storage", spec: { interface: "m2_nvme" } }),
    ])[0];
    expect(finding?.status).toBe("pass");
  });

  it("主板 M.2 数量缺失时未知", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: {} }),
      makeItem({ category: "storage", spec: { interface: "m2_nvme" } }),
    ])[0];
    expect(finding?.status).toBe("unknown");
  });
});

describe("R-STORAGE-002 存储数量与接口总数", () => {
  it("M.2 设备超过插槽数时阻断", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { m2Slots: 1, sataPorts: 4 } }),
      makeItem({ category: "storage", label: "SSD-A", spec: { interface: "m2_nvme" } }),
      makeItem({ category: "storage", label: "SSD-B", spec: { interface: "m2_nvme" } }),
    ])[0];
    expect(finding?.ruleId).toBe("R-STORAGE-002");
    expect(finding?.status).toBe("block");
  });

  it("数量在范围内时通过", () => {
    const finding = runBuildChecks([
      makeItem({ category: "motherboard", spec: { m2Slots: 2, sataPorts: 4 } }),
      makeItem({ category: "storage", label: "SSD-A", spec: { interface: "m2_nvme" } }),
      makeItem({ category: "storage", label: "HDD-B", spec: { interface: "sata" } }),
    ])[0];
    expect(finding?.status).toBe("pass");
  });
});

describe("报告排序与规则完整性", () => {
  it("结果按阻断 → 未知 → 警告 → 通过排序", () => {
    const findings = runBuildChecks([
      makeItem({ category: "motherboard", spec: { ramType: "DDR5", ramSlots: 2, pcieX16Slots: 1, m2Slots: 1, sataPorts: 2 } }),
      makeItem({ category: "ram", spec: { ddrType: "DDR4", sticks: 1 } }),
      makeItem({ category: "gpu", spec: { tdpWatts: 100, pcie8pin: 0 } }),
      makeItem({ category: "psu", spec: { ratedWatts: 850, pcie8pin: 2 } }),
    ]);
    const ranks = findings.map((f) => ({ block: 0, unknown: 1, warn: 2, pass: 3, not_applicable: 4 })[f.status]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(findings.length).toBeGreaterThanOrEqual(4);
  });

  it("空清单不产生任何结论", () => {
    expect(runBuildChecks([])).toEqual([]);
  });
});
