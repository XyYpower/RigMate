import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { priceEvidenceInputSchema } from "@/domain/price/evidence";
import {
  addPriceEvidence,
  listPriceEvidence,
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
});
