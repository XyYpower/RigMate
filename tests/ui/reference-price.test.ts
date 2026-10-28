import { describe, expect, it } from "vitest";
import { formatReferencePrice, referencePriceForItem } from "@/ui/workbench/reference-price";
import type { ReferencePriceItem } from "@/contracts/design";

const prices: ReferencePriceItem[] = [
  { category: "gpu", productName: "RTX 4080 SUPER 火神", priceCents: 749900 },
  { category: "cpu", priceCents: 489900, note: "盒装中位" },
];

describe("referencePriceForItem", () => {
  it("productName 双向包含命中优先于类别", () => {
    const item = { category: "gpu" as const, label: "七彩虹 iGame RTX 4080 SUPER 火神 OC" };
    expect(referencePriceForItem(item, prices)?.priceCents).toBe(749900);
  });

  it("无产品名命中时按类别取第一条", () => {
    const item = { category: "cpu" as const, label: "锐龙9 7950X3D" };
    expect(referencePriceForItem(item, prices)?.note).toBe("盒装中位");
  });

  it("类别不存在返回 null；空参考价列表返回 null", () => {
    expect(referencePriceForItem({ category: "case", label: "海景房" }, prices)).toBeNull();
    expect(referencePriceForItem({ category: "gpu", label: "任何" }, [])).toBeNull();
  });
});

describe("formatReferencePrice", () => {
  it("永远带参考字样与估算波浪号", () => {
    expect(formatReferencePrice(prices[1]!)).toBe("参考 ~¥4,899");
  });
});
