import { describe, expect, it } from "vitest";
import { percentile } from "@/application/agent/run-metrics";

// Phase 5 诊断聚合：百分位插值口径（最近端插值），空样本返回 null 不猜。

describe("percentile（诊断聚合）", () => {
  it("空样本 → null", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("单样本 → 自身", () => {
    expect(percentile([1200], 95)).toBe(1200);
  });

  it("多样本 P50/P95 插值", () => {
    expect(percentile([100, 200, 300, 400], 50)).toBe(250);
    expect(percentile([100, 200, 300, 400], 95)).toBe(385);
    expect(percentile([5000, 8000, 12000, 30000, 60000], 95)).toBe(54000);
  });
});
