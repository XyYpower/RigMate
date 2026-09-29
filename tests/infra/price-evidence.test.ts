import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { priceEvidenceInputSchema } from "@/domain/price/evidence";
import {
  addPriceEvidence,
  listPriceEvidence,
  priceEvidenceStats,
  reviewPriceEvidence,
} from "@/infra/db/repositories/price-evidence-repository";

const valid = {
  category: "motherboard",
  productName: "技嘉 B650M 小雕",
  priceCents: 109900,
  sourceType: "manual_entry",
  platform: "京东",
  condition: "全新",
} as const;

describe("价格证据领域校验（规格 §8.2）", () => {
  it("合法输入通过；价格为 0 / 负数 / 非法类别被拒", () => {
    expect(priceEvidenceInputSchema.safeParse(valid).success).toBe(true);
    expect(
      priceEvidenceInputSchema.safeParse({ ...valid, priceCents: 0 }).success,
    ).toBe(false);
    expect(
      priceEvidenceInputSchema.safeParse({ ...valid, priceCents: -5 }).success,
    ).toBe(false);
    expect(
      priceEvidenceInputSchema.safeParse({ ...valid, category: "瑞士军刀" }).success,
    ).toBe(false);
    expect(
      priceEvidenceInputSchema.safeParse({ ...valid, productName: "  " }).success,
    ).toBe(false);
  });
});

describe("price_evidence 仓储（追加式）", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "rigmate-price-evidence-"));

  beforeAll(() => {
    process.env.RIGMATE_DB_PATH = join(tempDir, "evidence.db");
  });

  afterAll(() => {
    (async () => {
      const { closeDatabase } = await import("@/infra/db/client");
      closeDatabase();
      rmSync(tempDir, { recursive: true, force: true });
    })();
  });

  it("插入两条后按时间倒序列出，可按类别过滤", () => {
    const first = addPriceEvidence({ ...valid, productName: "技嘉 B650M 小雕" });
    const second = addPriceEvidence({
      ...valid,
      category: "psu",
      productName: "鑫谷 无界PRO 850W",
      priceCents: 69900,
    });

    expect(second.id).not.toBe(first.id);

    const all = listPriceEvidence({});
    expect(all).toHaveLength(2);
    // 最近录入在前
    expect(all[0]?.productName).toBe("鑫谷 无界PRO 850W");

    const mb = listPriceEvidence({ category: "motherboard" });
    expect(mb).toHaveLength(1);
    expect(mb[0]?.productName).toBe("技嘉 B650M 小雕");

    const hit = listPriceEvidence({ q: "无界PRO" });
    expect(hit).toHaveLength(1);
    expect(hit[0]?.priceCents).toBe(69900);
  });

  it("Task 8：canonicalId / 地区 / 审核状态可录入与过滤；默认 unreviewed", () => {
    const bound = addPriceEvidence({
      ...valid,
      productName: "微星 B650M 迫击炮",
      canonicalProductId: "mb-msi-b650m-mortar",
      region: "中国大陆",
    });
    expect(bound.reviewStatus).toBe("unreviewed");
    expect(bound.canonicalProductId).toBe("mb-msi-b650m-mortar");
    expect(bound.region).toBe("中国大陆");

    const byProduct = listPriceEvidence({ canonicalProductId: "mb-msi-b650m-mortar" });
    expect(byProduct).toHaveLength(1);
    const byStatus = listPriceEvidence({ reviewStatus: "unreviewed" });
    expect(byStatus.some((row) => row.id === bound.id)).toBe(true);
  });

  it("Task 8：审核流转 verified / rejected，rejected 终态不可复活，价格值不可改", () => {
    const record = addPriceEvidence({ ...valid, productName: "审核测试电源" });
    const verified = reviewPriceEvidence(record.id, "verified");
    expect(verified.reviewStatus).toBe("verified");
    expect(verified.priceCents).toBe(record.priceCents);

    const another = addPriceEvidence({ ...valid, productName: "驳回测试内存" });
    const rejected = reviewPriceEvidence(another.id, "rejected");
    expect(rejected.reviewStatus).toBe("rejected");

    expect(() => reviewPriceEvidence(another.id, "verified")).toThrow(/终态/);
    expect(() => reviewPriceEvidence("pe-no-such", "verified")).toThrow(/不存在/);
  });

  it("Task 8：统计接口输出绑定比例与审核计数", () => {
    const stats = priceEvidenceStats();
    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(stats.withCanonicalId).toBeGreaterThanOrEqual(1);
    expect(stats.verified).toBeGreaterThanOrEqual(1);
    expect(stats.rejected).toBeGreaterThanOrEqual(1);
  });
});
