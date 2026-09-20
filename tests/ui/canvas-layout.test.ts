import { describe, expect, it } from "vitest";
import { computeCaseLayout, type CanvasItem } from "@/ui/canvas/layout";
import type { BuildItemCategory } from "@/domain/build/types";

function item(category: BuildItemCategory, spec: CanvasItem["spec"], label = "测试件"): CanvasItem {
  return { category, label, spec };
}

describe("computeCaseLayout 机器画布布局", () => {
  it("显卡超长时越界：violated + 越界说明", () => {
    const layout = computeCaseLayout([
      item("gpu", { lengthMm: 336 }),
      item("case", { maxGpuLengthMm: 320 }),
    ]);
    const gpu = layout.parts.find((part) => part.category === "gpu");
    expect(gpu?.violated).toBe(true);
    expect(gpu?.ghost).toBe(false);
    expect(layout.notes.join("；")).toContain("显卡长度 336mm 超出机箱限长 320mm");
    // 越界由限长标尺标注（红色 violated）
    const gpuRuler = layout.rulers.find((ruler) => ruler.kind === "gpu-length");
    expect(gpuRuler?.violated).toBe(true);
  });

  it("尺寸在限内时不越界", () => {
    const layout = computeCaseLayout([
      item("gpu", { lengthMm: 320 }),
      item("case", { maxGpuLengthMm: 320 }),
    ]);
    const gpu = layout.parts.find((part) => part.category === "gpu");
    expect(gpu?.violated).toBe(false);
    expect(layout.notes).toHaveLength(0);
  });

  it("散热器超限高时 violated，限内时通过", () => {
    const exceeded = computeCaseLayout([
      item("cooler", { heightMm: 175 }),
      item("case", { maxCoolerHeightMm: 170 }),
    ]);
    const cooler = exceeded.parts.find((part) => part.category === "cooler");
    expect(cooler?.violated).toBe(true);

    const within = computeCaseLayout([
      item("cooler", { heightMm: 158 }),
      item("case", { maxCoolerHeightMm: 170 }),
    ]);
    const cooler2 = within.parts.find((part) => part.category === "cooler");
    expect(cooler2?.violated).toBe(false);
  });

  it("板型不在机箱支持列表内时主板 violated", () => {
    const layout = computeCaseLayout([
      item("motherboard", { formFactor: "ITX" }),
      item("case", { supportedFormFactors: ["ATX"] }),
    ]);
    const mobo = layout.parts.find((part) => part.category === "motherboard");
    expect(mobo?.violated).toBe(true);
    expect(layout.notes.join("；")).toContain("主板板型 ITX 不在机箱支持列表");
  });

  it("缺关键规格的部件渲染为幽灵件（不猜默认值）", () => {
    const layout = computeCaseLayout([
      item("gpu", {}),
      item("cooler", {}),
      item("motherboard", {}),
    ]);
    const gpu = layout.parts.find((part) => part.category === "gpu");
    const cooler = layout.parts.find((part) => part.category === "cooler");
    const mobo = layout.parts.find((part) => part.category === "motherboard");
    expect(gpu?.ghost).toBe(true);
    expect(cooler?.ghost).toBe(true);
    expect(mobo?.ghost).toBe(true);
    // 幽灵长度标尺同样是 ghost 态
    const gpuRuler = layout.rulers.find((ruler) => ruler.kind === "gpu-length");
    expect(gpuRuler?.ghost).toBe(true);
  });

  it("无机箱或无机箱尺寸时内腔为幽灵态", () => {
    const noCase = computeCaseLayout([item("gpu", { lengthMm: 300 })]);
    expect(noCase.interiorGhost).toBe(true);

    const caseWithoutDims = computeCaseLayout([
      item("gpu", { lengthMm: 300 }),
      item("case", {}),
    ]);
    expect(caseWithoutDims.interiorGhost).toBe(true);

    const withDims = computeCaseLayout([
      item("gpu", { lengthMm: 300 }),
      item("case", { maxGpuLengthMm: 320 }),
    ]);
    expect(withDims.interiorGhost).toBe(false);
  });

  it("空清单仍输出有效内腔且无部件", () => {
    const layout = computeCaseLayout([]);
    expect(layout.parts).toHaveLength(0);
    expect(layout.interior.w).toBeGreaterThan(0);
    expect(layout.interior.h).toBeGreaterThan(0);
    expect(layout.interiorGhost).toBe(true);
  });

  it("输出坐标缩放到画布范围内且为正数", () => {
    const layout = computeCaseLayout([
      item("cpu", { socket: "AM5" }),
      item("motherboard", { formFactor: "E-ATX" }),
      item("gpu", { lengthMm: 400 }),
      item("ram", { ddrType: "DDR5", sticks: 4 }),
      item("storage", { interface: "m2_nvme" }),
      item("psu", { ratedWatts: 850 }),
      item("cooler", { heightMm: 168 }),
      item("case", { maxGpuLengthMm: 420, maxCoolerHeightMm: 175, supportedFormFactors: ["E-ATX"] }),
    ]);
    expect(layout.interior.w).toBeLessThanOrEqual(610);
    expect(layout.interior.h).toBeLessThanOrEqual(450);
    for (const part of layout.parts) {
      expect(part.x).toBeGreaterThanOrEqual(0);
      expect(part.y).toBeGreaterThanOrEqual(0);
      expect(part.w).toBeGreaterThan(0);
      expect(part.h).toBeGreaterThan(0);
    }
    // 全套配件下内存应画出 4 条
    expect(layout.parts.filter((part) => part.category === "ram")).toHaveLength(4);
  });
});
