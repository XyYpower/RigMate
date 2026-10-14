import { describe, expect, it } from "vitest";
import { runBuildChecks } from "@/domain/rules/engine";
import { makeItem } from "./cpu-motherboard.test";

// hw-agent 数据集增强规则（二期）：CPU M.2 直连通道 / 内存马甲避让 / 主板供电上限 / PSU PTP 公式

const find = (findings: ReturnType<typeof runBuildChecks>, ruleId: string) =>
  findings.find((finding) => finding.ruleId === ruleId);

describe("R-CPU-MB-002 CPU 直连 M.2 通道", () => {
  it("NVMe 数量超过 CPU 直连通道 → warn", () => {
    const finding = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { socket: "AM5", m2Lanes: 2 } }),
        makeItem({ category: "motherboard", spec: { m2Slots: 3 } }),
        makeItem({ category: "storage", spec: { interface: "m2_nvme" } }),
        makeItem({ category: "storage", label: "第二块 NVMe", spec: { interface: "m2_nvme" } }),
        makeItem({ category: "storage", label: "第三块 NVMe", spec: { interface: "m2_nvme" } }),
      ]),
      "R-CPU-MB-002",
    );
    expect(finding?.status).toBe("warn");
    expect(finding?.conclusion).toContain("3 块 NVMe");
  });

  it("数量在通道内 → pass", () => {
    const finding = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { socket: "AM5", m2Lanes: 4 } }),
        makeItem({ category: "storage", spec: { interface: "m2_nvme" } }),
      ]),
      "R-CPU-MB-002",
    );
    expect(finding?.status).toBe("pass");
  });

  it("CPU 无 m2Lanes 数据 → unknown；SATA 盘不参与", () => {
    const unknown = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { socket: "AM5" } }),
        makeItem({ category: "storage", spec: { interface: "m2_nvme" } }),
      ]),
      "R-CPU-MB-002",
    );
    expect(unknown?.status).toBe("unknown");

    const sataOnly = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { socket: "AM5" } }),
        makeItem({ category: "storage", spec: { interface: "sata" } }),
      ]),
      "R-CPU-MB-002",
    );
    expect(sataOnly).toBeUndefined();
  });
});

describe("R-COOLER-RAM-001 内存马甲 vs 散热器避让", () => {
  it("马甲高度超过避让间隙 → block", () => {
    const finding = find(
      runBuildChecks([
        makeItem({ category: "cooler", label: "双塔风冷", spec: { heightMm: 158, memoryClearanceMm: 42 } }),
        makeItem({ category: "ram", label: "高马甲 RGB", spec: { ddrType: "DDR5", heightMm: 44 } }),
      ]),
      "R-COOLER-RAM-001",
    );
    expect(finding?.status).toBe("block");
    expect(finding?.conclusion).toContain("44mm");
  });

  it("矮马甲通过；水冷（无避让字段）不适用", () => {
    const pass = find(
      runBuildChecks([
        makeItem({ category: "cooler", label: "双塔风冷", spec: { heightMm: 158, memoryClearanceMm: 42 } }),
        makeItem({ category: "ram", label: "矮马甲", spec: { ddrType: "DDR5", heightMm: 34 } }),
      ]),
      "R-COOLER-RAM-001",
    );
    expect(pass?.status).toBe("pass");

    const aio = find(
      runBuildChecks([
        makeItem({ category: "cooler", label: "360 水冷", spec: {} }),
        makeItem({ category: "ram", label: "高马甲", spec: { ddrType: "DDR5", heightMm: 44 } }),
      ]),
      "R-COOLER-RAM-001",
    );
    expect(aio).toBeUndefined();
  });
});

describe("R-MB-CPU-002 主板供电 vs CPU 功耗上限", () => {
  it("CPU PTP 超过主板标称上限 → warn", () => {
    const finding = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { socket: "AM5", tdpWatts: 170, ptpMaxWatts: 230 } }),
        makeItem({ category: "motherboard", spec: { socket: "AM5", targetCpuTdpWatts: 170 } }),
      ]),
      "R-MB-CPU-002",
    );
    expect(finding?.status).toBe("warn");
    expect(finding?.conclusion).toContain("230W");
  });

  it("上限内通过；主板未标称不适用", () => {
    const pass = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { socket: "AM5", tdpWatts: 65, ptpMaxWatts: 88 } }),
        makeItem({ category: "motherboard", spec: { socket: "AM5", targetCpuTdpWatts: 120 } }),
      ]),
      "R-MB-CPU-002",
    );
    expect(pass?.status).toBe("pass");

    const notApplicable = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { socket: "AM5", tdpWatts: 170 } }),
        makeItem({ category: "motherboard", spec: { socket: "AM5" } }),
      ]),
      "R-MB-CPU-002",
    );
    expect(notApplicable).toBeUndefined();
  });
});

describe("R-PSU-001 PTP 公式升级", () => {
  it("有 PTP 时按 PTP 估算（9800X3D PTP 120 + 4090 TGP 450 + 80 基线 = 650W）", () => {
    const finding = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { socket: "AM5", tdpWatts: 120, ptpMaxWatts: 120 } }),
        makeItem({ category: "gpu", spec: { tdpWatts: 450 } }),
        makeItem({ category: "psu", spec: { ratedWatts: 1000 } }),
      ]),
      "R-PSU-001",
    );
    expect(finding?.status).toBe("pass");
    expect(finding?.conclusion).toContain("650W");
  });

  it("无 PTP 回退 TDP", () => {
    const finding = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { socket: "AM5", tdpWatts: 65 } }),
        makeItem({ category: "gpu", spec: { tdpWatts: 145 } }),
        makeItem({ category: "psu", spec: { ratedWatts: 500 } }),
      ]),
      "R-PSU-001",
    );
    expect(finding?.status).toBe("pass");
    expect(finding?.conclusion).toContain("290W");
  });
});

describe("R-CPU-GPU-001 无核显 CPU 必须配独显", () => {
  const base = { socket: "AM5", tdpWatts: 65 };

  it("无核显 CPU 且未配独显 → block", () => {
    const finding = find(
      runBuildChecks([makeItem({ category: "cpu", label: "锐龙5 7500F", spec: { ...base, hasIgpu: false } })]),
      "R-CPU-GPU-001",
    );
    expect(finding?.status).toBe("block");
    expect(finding?.conclusion).toContain("无法点亮");
  });

  it("配了独显则不适用；带核显通过", () => {
    const withGpu = find(
      runBuildChecks([
        makeItem({ category: "cpu", spec: { ...base, hasIgpu: false } }),
        makeItem({ category: "gpu", spec: { tdpWatts: 220 } }),
      ]),
      "R-CPU-GPU-001",
    );
    expect(withGpu).toBeUndefined();

    const igpu = find(
      runBuildChecks([makeItem({ category: "cpu", spec: { ...base, hasIgpu: true } })]),
      "R-CPU-GPU-001",
    );
    expect(igpu?.status).toBe("pass");
  });

  it("hasIgpu 缺失 → unknown（不猜）", () => {
    const finding = find(
      runBuildChecks([makeItem({ category: "cpu", spec: base })]),
      "R-CPU-GPU-001",
    );
    expect(finding?.status).toBe("unknown");
  });
});
