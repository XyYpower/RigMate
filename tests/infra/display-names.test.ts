import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// 中文展示名解析（infra/catalog-import/display-names）：独立临时库，
// JSON 目录源指向不存在路径，保证测的是"查库解析"而不是 JSON 兜底
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-display-names-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "display.db");
process.env.RIGMATE_BUILDCORES_CATALOG_PATH = join(tempDir, "no-buildcores.json");
process.env.RIGMATE_MANUAL_CATALOG_PATH = join(tempDir, "no-manual.json");

const repo = await import("@/infra/db/repositories/catalog-repository");
const { resetBuildcoresCatalogCacheForTests } = await import("@/infra/catalog-import/load");
const {
  catalogIdFromSource,
  decorateBuildItems,
  decorateCatalogEntries,
  decorateProposalItems,
  displayForCatalogId,
  resetDisplayIndexCacheForTests,
} = await import("@/infra/catalog-import/display-names");
const { closeDatabase } = await import("@/infra/db/client");

const GPU_EN = "NVIDIA GeForce RTX 4070 SUPER 12G VENTUS 3X OC";
const MB_EN = "ROG STRIX B850-A GAMING WIFI7 S NEO";
const MB_ZH = "ROG STRIX B850-A GAMING WIFI7 S NEO 吹雪";

function seed(): void {
  // 反复调用安全：upsert 是 first-wins，同 id 重复写入会被跳过，内容不变
  repo.upsertCatalogEntries([
    {
      id: "gpu-msi-ventus",
      category: "gpu",
      name: GPU_EN,
      aliases: ["4070s ventus"],
      spec: { tdpWatts: 220 },
      source: "manufacturer_cn",
    },
    {
      id: "cn-asus-b850a",
      category: "motherboard",
      name: MB_EN,
      nameZh: MB_ZH,
      aliases: ["90MB1P40-M0CAY0"],
      spec: { socket: "AM5" },
      source: "manufacturer_cn",
    },
  ]);
  resetBuildcoresCatalogCacheForTests();
  resetDisplayIndexCacheForTests();
}

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("catalogIdFromSource", () => {
  it("只认 catalog: 前缀", () => {
    expect(catalogIdFromSource("catalog:gpu-msi-ventus")).toBe("gpu-msi-ventus");
    expect(catalogIdFromSource("catalog:")).toBeNull();
    expect(catalogIdFromSource("manual")).toBeNull();
    expect(catalogIdFromSource(undefined)).toBeNull();
    expect(catalogIdFromSource(null)).toBeNull();
    expect(catalogIdFromSource("")).toBeNull();
  });
});

describe("中文展示名解析", () => {
  it("厂商前缀本地化，英文原名完整保留", () => {
    seed();
    const display = displayForCatalogId("gpu-msi-ventus");
    expect(display?.displayName).toBe("英伟达 GeForce RTX 4070 SUPER 12G VENTUS 3X OC");
    expect(display?.displayNameOriginal).toBe(GPU_EN);
    expect(display?.displayNameBasis).toBe("vendor_zh");
  });

  it("官网中文名压过厂商前缀推导", () => {
    seed();
    const display = displayForCatalogId("cn-asus-b850a");
    expect(display?.displayName).toBe(MB_ZH);
    expect(display?.displayNameOriginal).toBe(MB_EN);
    expect(display?.displayNameBasis).toBe("official_cn");
  });

  it("查不到目录条目时返回 null（不猜）", () => {
    seed();
    expect(displayForCatalogId("does-not-exist")).toBeNull();
    expect(displayForCatalogId(undefined)).toBeNull();
  });
});

describe("decorateProposalItems", () => {
  it("按 catalogId 挂中文名，label 原样不动", () => {
    seed();
    const [item] = decorateProposalItems([
      { label: MB_EN, catalogId: "cn-asus-b850a" },
      { label: "用户自己写的型号", catalogId: undefined },
    ]);
    expect(item.displayName).toBe(MB_ZH);
    expect(item.displayNameOriginal).toBe(MB_EN);
    // 关键红线：label 绝不能被本地化改写
    expect(item.label).toBe(MB_EN);
  });

  it("没有 catalogId 的方案项原样显示", () => {
    seed();
    const [item] = decorateProposalItems([{ label: "用户自己写的型号" }]);
    expect(item.displayName).toBe("用户自己写的型号");
    expect(item.displayNameBasis).toBe("en_only");
  });

  it("目录条目被合并后（查不到）也不崩，降级为原名", () => {
    seed();
    const [item] = decorateProposalItems([{ label: GPU_EN, catalogId: "merged-away-id" }]);
    expect(item.displayName).toBe(GPU_EN);
    expect(item.displayNameBasis).toBe("en_only");
  });
});

describe("decorateBuildItems", () => {
  it("按 source 里的目录 id 解析中文名", () => {
    seed();
    const [fromCatalog, fromUser] = decorateBuildItems([
      { label: GPU_EN, source: "catalog:gpu-msi-ventus" },
      { label: "9800X3D", source: "manual" },
    ]);
    expect(fromCatalog.displayName).toBe("英伟达 GeForce RTX 4070 SUPER 12G VENTUS 3X OC");
    expect(fromCatalog.displayNameOriginal).toBe(GPU_EN);
    // 红线：label 绝不能被本地化改写
    expect(fromCatalog.label).toBe(GPU_EN);
    // 用户手填的型号不该被本地化改写
    expect(fromUser.displayName).toBe("9800X3D");
    expect(fromUser.displayNameBasis).toBe("en_only");
  });
});

describe("decorateCatalogEntries", () => {
  it("目录条目挂展示字段，不改 name", () => {
    const entries = decorateCatalogEntries([
      { id: "a", category: "gpu", name: GPU_EN, nameZh: null },
      { id: "b", category: "motherboard", name: MB_EN, nameZh: MB_ZH },
    ]);
    expect(entries[0].displayName).toBe("英伟达 GeForce RTX 4070 SUPER 12G VENTUS 3X OC");
    expect(entries[0].name).toBe(GPU_EN);
    expect(entries[1].displayName).toBe(MB_ZH);
    expect(entries[1].name).toBe(MB_EN);
  });

  it("同类别内截断后撞车 → 自动放弃截断，两款仍可分辨", () => {
    const entries = decorateCatalogEntries([
      { id: "ram-32", category: "ram", name: "Kingston FURY Beast 6000MT/s 32GB (2x16GB)", nameZh: null },
      { id: "ram-16", category: "ram", name: "Kingston FURY Beast 6000MT/s 16GB (1x16GB)", nameZh: null },
    ]);
    // 两者原本会被截成同一个"金士顿 FURY Beast"
    expect(entries[0].displayName).not.toBe(entries[1].displayName);
    expect(entries[0].displayNameUntrimmed).toBe(true);
    expect(entries[1].displayNameUntrimmed).toBe(true);
    // 厂商中文名仍然保留，只是尾部参数没裁
    expect(entries[0].displayName).toContain("金士顿");
    expect(entries[0].displayName).toContain("32GB");
  });

  it("不撞车的条目仍然截断（保持可读性）", () => {
    const [entry] = decorateCatalogEntries([
      { id: "ram-32", category: "ram", name: "Kingston FURY Beast 6000MT/s 32GB (2x16GB)", nameZh: null },
    ]);
    expect(entry.displayName).toBe("金士顿 FURY Beast");
    expect(entry.displayNameUntrimmed).toBe(false);
  });

  it("跨类别同名的条目各自独立，不互相回退", () => {
    const entries = decorateCatalogEntries([
      { id: "x", category: "ram", name: "ADATA XPG 32GB 6000MT/s", nameZh: null },
      { id: "y", category: "storage", name: "ADATA XPG 32GB 6000MT/s", nameZh: null },
    ]);
    expect(entries[0].displayNameUntrimmed).toBe(false);
    expect(entries[1].displayNameUntrimmed).toBe(false);
  });
});
