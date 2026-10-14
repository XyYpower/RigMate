import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { toDiscoveredProduct, type AsusProductResult } from "@/infra/catalog-import/cn/asus";

const tempDir = mkdtempSync(join(tmpdir(), "rigmate-cn-source-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "catalog.db");

const { closeDatabase } = await import("@/infra/db/client");
const { loadCatalogEntries, setCatalogQualityStatus } = await import("@/infra/db/repositories/catalog-repository");
const { listFieldEvidence, listProductSources } = await import("@/infra/db/repositories/evidence-repository");
const { listPriceEvidence } = await import("@/infra/db/repositories/price-evidence-repository");
import type { MainlandImportReport } from "@/infra/catalog-import/cn/import";
const { importManufacturerCnProducts } = await import("@/infra/catalog-import/cn/import");

// 华硕解析结果经 toDiscoveredProduct 转换后走通用落库通道（与微星同一条证据链）
const importAsus = (products: AsusProductResult[]): MainlandImportReport =>
  importManufacturerCnProducts(products.map(toDiscoveredProduct));

const product: AsusProductResult = {
  id: "cn-asus-90mb1j70-m0cay0",
  category: "motherboard",
  name: "ROG STRIX B850-F GAMING WIFI",
  aliases: ["90MB1J70-M0CAY0"],
  spec: {
    socket: "AM5",
    ramType: "DDR5",
    formFactor: "ATX",
    ramSlots: 4,
    m2Slots: 4,
    sataPorts: 2,
    pcieX16Slots: 1,
  },
  refUrl: "https://rog.asus.com.cn/motherboards/rog-strix/rog-strix-b850-f-gaming-wifi/spec/",
  source: "manufacturer_cn",
  manufacturer: "ROG",
  mpn: "90MB1J70-M0CAY0",
  sourceUrl: "https://rog.asus.com.cn/motherboards/rog-strix/rog-strix-b850-f-gaming-wifi/spec/",
  sourceTitle: "ROG STRIX B850-F GAMING WIFI",
  sourceVersion: "sha256:test",
  contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  priceCny: 2499,
  evidence: [
    { fieldPath: "spec.socket", value: "AM5", excerpt: "AMD AM5 插槽" },
    { fieldPath: "spec.m2Slots", value: 4, excerpt: "共支持 4 个 M.2 插槽" },
  ],
};

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("中国大陆厂商目录导入", () => {
  it("自动写入产品、来源、字段证据和大陆价格，并按完整度标记 supported", () => {
    const report = importAsus([product]);

    expect(report).toEqual({ inserted: 1, skipped: 0, sources: 1, evidence: 2, prices: 1 });
    expect(loadCatalogEntries().find((entry) => entry.id === product.id)).toMatchObject({
      source: "manufacturer_cn",
      qualityStatus: "supported",
      mpn: product.mpn,
    });
    expect(listProductSources(product.id)).toHaveLength(1);
    expect(listFieldEvidence(product.id)).toHaveLength(2);
    expect(listPriceEvidence({ canonicalProductId: product.id })).toMatchObject([
      {
        priceCents: 249900,
        sourceType: "manufacturer_page",
        platform: "ROG 中国大陆官网",
        region: "中国大陆",
        reviewStatus: "unreviewed",
      },
    ]);
  });

  it("同一产品重复同步不会重复插入目录", () => {
    const report = importAsus([product]);

    expect(report.inserted).toBe(0);
    expect(report.skipped).toBe(1);
    expect(loadCatalogEntries().filter((entry) => entry.id === product.id)).toHaveLength(1);
  });

  it("解析器版本变化时，即使页面哈希相同也追加新快照", () => {
    const parserProduct = {
      ...product,
      id: "cn-asus-parser-version",
      name: "ROG PARSER VERSION BOARD",
      mpn: "90PARSER-M0CAY0",
      sourceUrl: "https://rog.asus.com.cn/motherboards/rog-strix/parser-version/spec/",
      refUrl: "https://rog.asus.com.cn/motherboards/rog-strix/parser-version/spec/",
      sourceVersion: "asus-rog-spec-v1",
    };
    importAsus([parserProduct]);
    importAsus([{ ...parserProduct, sourceVersion: "asus-rog-spec-v2" }]);

    expect(listProductSources(parserProduct.id)).toHaveLength(2);
  });

  it("页面内容变化时追加新来源和价格，并将旧来源标记为 stale", () => {
    const changed = {
      ...product,
      contentHash: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      priceCny: 2599,
      spec: { ...product.spec, pcieX16Slots: 2 },
    };
    const report = importAsus([changed]);

    expect(report).toEqual({ inserted: 0, skipped: 0, sources: 1, evidence: 2, prices: 1 });
    expect(listProductSources(product.id)).toHaveLength(2);
    expect(listProductSources(product.id).map((source) => source.status).sort()).toEqual(["stale", "unreviewed"]);
    expect(listPriceEvidence({ canonicalProductId: product.id })).toHaveLength(2);
    expect(listPriceEvidence({ canonicalProductId: product.id })[0]?.priceCents).toBe(259900);
    expect(loadCatalogEntries().find((entry) => entry.id === product.id)?.spec.pcieX16Slots).toBe(2);
  });

  it("缺少主板必填字段时标记为 partial", () => {
    const partial = {
      ...product,
      id: "cn-asus-partial",
      name: "ROG PARTIAL BOARD",
      mpn: "90PARTIAL-M0CAY0",
      aliases: ["90PARTIAL-M0CAY0"],
      sourceUrl: "https://rog.asus.com.cn/motherboards/rog-strix/partial/spec/",
      refUrl: "https://rog.asus.com.cn/motherboards/rog-strix/partial/spec/",
      spec: { socket: "AM5", ramType: "DDR5" },
      evidence: [
        { fieldPath: "spec.socket" as const, value: "AM5", excerpt: "AMD AM5 插槽" },
        { fieldPath: "spec.ramType" as const, value: "DDR5", excerpt: "DDR5" },
      ],
    };
    importAsus([partial]);

    expect(loadCatalogEntries().find((entry) => entry.id === partial.id)?.qualityStatus).toBe("partial");

    // 旧版本曾把同一快照错误标为 supported；重跑同步也必须纠正它。
    setCatalogQualityStatus(partial.id, "supported");
    importAsus([partial]);
    expect(loadCatalogEntries().find((entry) => entry.id === partial.id)?.qualityStatus).toBe("partial");
  });
});
