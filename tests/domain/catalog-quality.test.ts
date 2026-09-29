import { describe, expect, it } from "vitest";
import {
  canonicalProductRecordSchema,
  dataQualityEventSchema,
  pendingCatalogItemSchema,
  productFieldEvidenceSchema,
  productSourceSchema,
} from "@/contracts/catalog";
import {
  computeFieldQuality,
  computeProductQualityStatus,
  identityMatchOf,
  isRuleUsable,
  isValidSpecFieldValue,
  requiredFieldsOf,
  type FieldEvidenceFact,
  type ProductIdentity,
} from "@/domain/catalog/quality";

const NOW = "2026-09-29T00:00:00.000Z";

function fact(overrides: Partial<FieldEvidenceFact> = {}): FieldEvidenceFact {
  return {
    id: "ev-1",
    value: 400,
    tier: "S1",
    identityMatch: "mpn_exact",
    status: "verified",
    capturedAt: "2026-09-20T00:00:00.000Z",
    supersedesId: null,
    ...overrides,
  };
}

describe("identityMatchOf", () => {
  const base: ProductIdentity = { manufacturer: "MSI", series: "RTX 4070 SUPER", model: "GeForce RTX 4070 SUPER 12G VENTUS 3X", variant: "Ventus 3X", mpn: null };

  it("matches exactly on normalized MPN", () => {
    expect(identityMatchOf({ ...base, mpn: "GEO RTX4070S V3X" }, { ...base, mpn: "geo rtx4070s  v3x" })).toBe("mpn_exact");
  });

  it("treats different MPNs as unmatched even when names look alike", () => {
    expect(identityMatchOf({ ...base, mpn: "AAA-111" }, { ...base, mpn: "BBB-222" })).toBe("unmatched");
  });

  it("matches fields when no MPN exists and at least two of maker/model/variant agree", () => {
    expect(identityMatchOf(base, { ...base, variant: null, mpn: null })).toBe("fields_matched");
    expect(identityMatchOf(base, { ...base, model: null, mpn: null })).toBe("fields_matched");
  });

  it("rejects mismatched variants of the same chip series", () => {
    const other: ProductIdentity = { ...base, model: "GeForce RTX 4070 SUPER 12G GAMING X TRIO", variant: "Gaming X Trio", mpn: null };
    expect(identityMatchOf(base, other)).toBe("unmatched");
  });

  it("never lets series alone establish identity", () => {
    const seriesOnly: ProductIdentity = { manufacturer: "MSI", series: "RTX 4070 SUPER", model: null, variant: null, mpn: null };
    expect(identityMatchOf(base, seriesOnly)).toBe("unmatched");
  });
});

describe("isValidSpecFieldValue", () => {
  it("accepts schema-valid values", () => {
    expect(isValidSpecFieldValue("gpu", "lengthMm", 400)).toBe(true);
    expect(isValidSpecFieldValue("storage", "interface", "m2_nvme")).toBe(true);
  });

  it("rejects wrong units and types", () => {
    expect(isValidSpecFieldValue("gpu", "lengthMm", "400mm")).toBe(false);
    expect(isValidSpecFieldValue("gpu", "lengthMm", -400)).toBe(false);
    expect(isValidSpecFieldValue("gpu", "lengthMm", 400.5)).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(isValidSpecFieldValue("gpu", "color", "white")).toBe(false);
  });
});

describe("computeFieldQuality", () => {
  it("returns unknown for a field with no evidence", () => {
    const result = computeFieldQuality("gpu", "lengthMm", []);
    expect(result.status).toBe("unknown");
    expect(result.value).toBeUndefined();
    expect(result.reason).toContain("暂无任何来源证据");
  });

  it("verifies human-reviewed S1/S2 evidence with clear identity", () => {
    const s1 = computeFieldQuality("gpu", "lengthMm", [fact()]);
    expect(s1.status).toBe("verified");
    expect(s1.value).toBe(400);

    const s2 = computeFieldQuality("gpu", "lengthMm", [fact({ tier: "S2" })]);
    expect(s2.status).toBe("verified");
  });

  it("caps unreviewed evidence at supported", () => {
    const result = computeFieldQuality("gpu", "lengthMm", [fact({ status: "unreviewed" })]);
    expect(result.status).toBe("supported");
    expect(result.reason).toContain("未经人工复核");
  });

  it("caps non-first-hand sources at supported", () => {
    const s3 = computeFieldQuality("gpu", "lengthMm", [fact({ tier: "S3", status: "unreviewed" })]);
    expect(s3.status).toBe("supported");
    expect(s3.reason).toContain("非厂商一手");
  });

  it("caps identity-unclear evidence at supported", () => {
    const result = computeFieldQuality("gpu", "lengthMm", [fact({ identityMatch: "unmatched" })]);
    expect(result.status).toBe("supported");
    expect(result.reason).toContain("变体");
  });

  it("marks fields without any usable evidence as unknown", () => {
    const rejected = computeFieldQuality("gpu", "lengthMm", [fact({ status: "rejected" })]);
    expect(rejected.status).toBe("rejected");

    const invalid = computeFieldQuality("gpu", "lengthMm", [fact({ value: "400mm" })]);
    expect(invalid.status).toBe("unknown");
    expect(invalid.reason).toContain("schema");

    const notAFact = computeFieldQuality("gpu", "lengthMm", [
      fact({ tier: "S0" }),
      fact({ id: "ev-2", tier: "S5" }),
    ]);
    expect(notAFact.status).toBe("unknown");
    expect(notAFact.reason).toContain("不构成规格事实");
  });

  it("resolves tier conflicts in favor of the higher tier but keeps the field at supported", () => {
    const result = computeFieldQuality("gpu", "lengthMm", [
      fact({ id: "ev-s1", value: 400, tier: "S1" }),
      fact({ id: "ev-s2", value: 397, tier: "S2", status: "unreviewed" }),
    ]);
    expect(result.status).toBe("supported");
    expect(result.conflict).toBe("resolved");
    expect(result.value).toBe(400);
    expect(result.usedEvidenceIds).toEqual(["ev-s1"]);
    expect(result.reason).toContain("待人工复核");
  });

  it("reports unresolved conflicts between same-tier sources without a value", () => {
    const result = computeFieldQuality("gpu", "lengthMm", [
      fact({ id: "ev-a", value: 400, tier: "S2" }),
      fact({ id: "ev-b", value: 397, tier: "S2" }),
    ]);
    expect(result.status).toBe("conflicting");
    expect(result.conflict).toBe("unresolved");
    expect(result.value).toBeUndefined();
  });

  it("demotes identity-unclear evidence to reference-only instead of creating a conflict", () => {
    const result = computeFieldQuality("gpu", "lengthMm", [
      fact({ id: "ev-good", value: 400, tier: "S2", status: "unreviewed", identityMatch: "fields_matched" }),
      fact({ id: "ev-sibling", value: 380, tier: "S1", identityMatch: "unmatched" }),
    ]);
    // 兄弟变体页面的长度不能代表本变体（不用公版/兄弟型号数据推断），但也不构成同变体冲突
    expect(result.status).toBe("supported");
    expect(result.conflict).toBe("none");
    expect(result.value).toBe(400);
    expect(result.excluded).toEqual([{ id: "ev-sibling", reason: "identity_unclear" }]);
  });

  it("marks expired evidence as stale", () => {
    const expired = computeFieldQuality("gpu", "lengthMm", [fact({ capturedAt: "2026-06-21T00:00:00.000Z" })], {
      now: NOW,
      staleAfterDays: 90,
    });
    expect(expired.status).toBe("stale");

    const explicitlyStale = computeFieldQuality("gpu", "lengthMm", [fact({ status: "stale" })]);
    expect(explicitlyStale.status).toBe("stale");
  });

  it("prefers fresh evidence when stale evidence of the same value exists", () => {
    const result = computeFieldQuality("gpu", "lengthMm", [
      fact({ id: "ev-old", capturedAt: "2026-06-21T00:00:00.000Z" }),
      fact({ id: "ev-new", capturedAt: "2026-09-20T00:00:00.000Z" }),
    ], { now: NOW, staleAfterDays: 90 });
    expect(result.status).toBe("verified");
    expect(result.usedEvidenceIds).toEqual(["ev-new"]);
    expect(result.excluded.map((item) => item.id)).toEqual(["ev-old"]);
  });

  it("ignores superseded evidence", () => {
    const result = computeFieldQuality("gpu", "lengthMm", [
      fact({ id: "ev-old", value: 380 }),
      fact({ id: "ev-new", value: 400, supersedesId: "ev-old" }),
    ]);
    expect(result.status).toBe("verified");
    expect(result.value).toBe(400);
    expect(result.usedEvidenceIds).toEqual(["ev-new"]);
  });

  it("keeps valid evidence when invalid-unit evidence is mixed in", () => {
    const result = computeFieldQuality("gpu", "lengthMm", [
      fact({ id: "ev-bad", value: "约 400" }),
      fact({ id: "ev-good", value: 400 }),
    ]);
    expect(result.status).toBe("verified");
    expect(result.value).toBe(400);
    expect(result.excluded).toEqual([{ id: "ev-bad", reason: "invalid_value" }]);
  });
});

describe("computeProductQualityStatus / isRuleUsable", () => {
  it("aggregates field statuses with severity precedence", () => {
    expect(computeProductQualityStatus({})).toBe("partial");
    expect(computeProductQualityStatus({ a: "verified", b: "verified" })).toBe("verified");
    expect(computeProductQualityStatus({ a: "verified", b: "supported" })).toBe("supported");
    expect(computeProductQualityStatus({ a: "supported", b: "unknown" })).toBe("partial");
    expect(computeProductQualityStatus({ a: "stale", b: "unknown" })).toBe("stale");
    expect(computeProductQualityStatus({ a: "conflicting", b: "stale" })).toBe("conflicting");
    expect(computeProductQualityStatus({ a: "rejected", b: "verified" })).toBe("rejected");
  });

  it("only lets verified/supported fields through the rule gate", () => {
    expect(isRuleUsable("verified")).toBe(true);
    expect(isRuleUsable("supported")).toBe(true);
    for (const status of ["partial", "conflicting", "stale", "unknown", "rejected"] as const) {
      expect(isRuleUsable(status)).toBe(false);
    }
  });

  it("exposes the required-field matrix from the audit single source", () => {
    expect(requiredFieldsOf("gpu")).toEqual(["lengthMm", "tdpWatts", "pcie8pin", "twelveVhpwr"]);
  });
});

describe("catalog quality contracts", () => {
  it("parses a full canonical product record with slug id and quality columns", () => {
    const parsed = canonicalProductRecordSchema.parse({
      id: "gpu-msi-4070s-ventus",
      category: "gpu",
      name: "微星 RTX 4070 SUPER 12G VENTUS 3X",
      aliases: ["4070s ventus"],
      spec: { lengthMm: 400, tdpWatts: 220, pcie8pin: 0, twelveVhpwr: 1 },
      refUrl: null,
      manufacturer: "MSI",
      series: "GeForce RTX 4070 SUPER",
      model: "GeForce RTX 4070 SUPER 12G VENTUS 3X",
      variant: "Ventus 3X",
      mpn: null,
      qualityStatus: "supported",
      sourceVersion: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(parsed.qualityStatus).toBe("supported");
  });

  it("enforces the spec.<field> evidence path format", () => {
    const base = {
      id: "0b8f9d86-0b5e-4f6a-9a55-2f1b3c9d7e01",
      canonicalProductId: "gpu-msi-4070s-ventus",
      sourceId: "0b8f9d86-0b5e-4f6a-9a55-2f1b3c9d7e02",
      excerpt: "显卡长度 400mm",
      identityMatch: "mpn_exact",
      confidence: "high",
      verifiedAt: NOW,
      verifiedBy: "reviewer",
      supersedesId: null,
      createdAt: NOW,
    };
    expect(productFieldEvidenceSchema.parse({ ...base, fieldPath: "spec.lengthMm", value: 400 }).value).toBe(400);
    expect(productFieldEvidenceSchema.safeParse({ ...base, fieldPath: "lengthMm", value: 400 }).success).toBe(false);
  });

  it("parses product source, quality event and pending queue items", () => {
    const source = productSourceSchema.parse({
      id: "0b8f9d86-0b5e-4f6a-9a55-2f1b3c9d7e03",
      canonicalProductId: "gpu-msi-4070s-ventus",
      sourceType: "manufacturer",
      tier: "S1",
      sourceUrl: "https://www.msi.com/Graphics-Card/GeForce-RTX-4070-SUPER-12G-VENTUS-3X",
      sourceTitle: "MSI 产品规格页",
      sourceVersion: null,
      license: null,
      capturedAt: NOW,
      contentHash: "a1b2c3d4e5",
      status: "verified",
      reviewerNote: null,
    });
    expect(source.tier).toBe("S1");

    dataQualityEventSchema.parse({
      id: "0b8f9d86-0b5e-4f6a-9a55-2f1b3c9d7e04",
      canonicalProductId: "gpu-msi-4070s-ventus",
      eventType: "conflict",
      beforeJson: { lengthMm: 400 },
      afterJson: null,
      reason: "S2 来源长度 397 与 S1 400 冲突",
      actor: "import:buildcores",
      createdAt: NOW,
    });

    const queueItem = pendingCatalogItemSchema.parse({
      id: "0b8f9d86-0b5e-4f6a-9a55-2f1b3c9d7e05",
      queueType: "new_product",
      category: "gpu",
      userInput: "4070s ventus 白色",
      candidateCanonicalIds: [],
      missingFields: ["lengthMm"],
      priority: "normal",
      reason: "用户搜索未命中目录",
      status: "open",
      assignedTo: null,
      resolutionNote: null,
      createdAt: NOW,
      updatedAt: NOW,
      resolvedAt: null,
    });
    expect(queueItem.status).toBe("open");
  });
});
