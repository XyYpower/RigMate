import { describe, expect, it } from "vitest";
import { buildSpecPayload, CATEGORY_META, specToFormValues } from "@/ui/category-form";

const gpuMeta = CATEGORY_META.gpu;

describe("配件表单提交解析（buildSpecPayload）", () => {
  it("计数类字段允许 0——仅 12VHPWR 供电的显卡 8pin 数就是 0（M19）", () => {
    const { spec, error } = buildSpecPayload(gpuMeta, {
      lengthMm: "227",
      tdpWatts: "220",
      pcie8pin: "0",
      twelveVhpwr: "1",
    });
    expect(error).toBeNull();
    expect(spec).toEqual({ lengthMm: 227, tdpWatts: 220, pcie8pin: 0, twelveVhpwr: 1 });
  });

  it("计数类字段拒绝负数", () => {
    const { error } = buildSpecPayload(gpuMeta, { pcie8pin: "-1" });
    expect(error).toContain("非负整数");
  });

  it("正整数类字段仍拒绝 0", () => {
    const { error } = buildSpecPayload(gpuMeta, { tdpWatts: "0" });
    expect(error).toContain("正整数");
  });

  it("specToFormValues 与 buildSpecPayload 往返一致（含 0 值）", () => {
    const spec = { lengthMm: 227, tdpWatts: 220, pcie8pin: 0, twelveVhpwr: 1 };
    const values = specToFormValues(gpuMeta, spec);
    const reparsed = buildSpecPayload(gpuMeta, values);
    expect(reparsed.error).toBeNull();
    expect(reparsed.spec).toEqual(spec);
  });
});
