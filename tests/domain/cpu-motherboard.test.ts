import { describe, expect, it } from "vitest";
import { checkCpuMotherboardSocket } from "@/domain/rules/cpu-motherboard";
import type { BuildItem } from "@/domain/build/types";

type ItemOverrides = {
  category?: BuildItem["category"];
  label?: string;
  spec?: Record<string, unknown>;
};

export function makeItem(overrides: ItemOverrides = {}): BuildItem {
  return {
    id: overrides.label ?? crypto.randomUUID(),
    buildId: "build-1",
    category: overrides.category ?? "cpu",
    label: overrides.label ?? "测试配件",
    spec: overrides.spec ?? {},
    createdAt: new Date().toISOString(),
  } as BuildItem;
}

describe("R-CPU-MB-001 CPU 与主板插槽", () => {
  it("相同插槽通过", () => {
    const finding = checkCpuMotherboardSocket([
      makeItem({ category: "cpu", label: "Ryzen 7 7800X3D", spec: { socket: "AM5" } }),
      makeItem({ category: "motherboard", label: "B650M", spec: { socket: "AM5" } }),
    ]);
    expect(finding?.status).toBe("pass");
    expect(finding?.ruleId).toBe("R-CPU-MB-001");
  });

  it("大小写不同但同插槽也算通过", () => {
    const finding = checkCpuMotherboardSocket([
      makeItem({ category: "cpu", spec: { socket: "am5" } }),
      makeItem({ category: "motherboard", spec: { socket: "AM5" } }),
    ]);
    expect(finding?.status).toBe("pass");
  });

  it("不同插槽阻断", () => {
    const finding = checkCpuMotherboardSocket([
      makeItem({ category: "cpu", spec: { socket: "AM5" } }),
      makeItem({ category: "motherboard", spec: { socket: "LGA1700" } }),
    ]);
    expect(finding?.status).toBe("block");
    expect(finding?.suggestedAction).toContain("更换");
  });

  it("缺少插槽时保持未知，不猜测", () => {
    const finding = checkCpuMotherboardSocket([
      makeItem({ category: "cpu", spec: { socket: "AM5" } }),
      makeItem({ category: "motherboard" }),
    ]);
    expect(finding?.status).toBe("unknown");
    expect(finding?.missingFields).toContain("主板插槽");
  });
});
