import { describe, expect, it } from "vitest";
import { CATALOG, type CatalogEntry } from "@/domain/catalog/seed";
import { findCatalogEntry, searchCatalog } from "@/domain/catalog/search";
import { specSchemaByCategory } from "@/domain/build/specs";

describe("标准型号目录（种子）", () => {
  it("全部条目的 spec 都通过对应类别的 schema 校验", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(30);
    for (const entry of CATALOG) {
      expect(() => specSchemaByCategory[entry.category].parse(entry.spec)).not.toThrow();
    }
  });

  it("id 唯一且类别合法", () => {
    const ids = CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("目录检索", () => {
  it("按类别过滤", () => {
    const cpus = searchCatalog(CATALOG, "cpu", null);
    expect(cpus.length).toBeGreaterThanOrEqual(6);
    expect(cpus.every((entry) => entry.category === "cpu")).toBe(true);
  });

  it("按名称与别名模糊匹配（大小写不敏感）", () => {
    const byName = searchCatalog(CATALOG, "cpu", "9800X3D");
    expect(byName.some((entry) => entry.id === "cpu-9800x3d")).toBe(true);

    const byAlias = searchCatalog(CATALOG, "motherboard", "迫击炮");
    expect(byAlias.some((entry) => entry.id === "mb-msi-b650m-mortar")).toBe(true);
  });

  it("限制返回条数", () => {
    const limited = searchCatalog(CATALOG, "cpu", null, 2);
    expect(limited).toHaveLength(2);
  });

  it("能搜到本地化后的中文展示名（界面显示什么就搜得到什么）", () => {
    // 回归：目录里 name 是 "MSI GeForce…"，界面显示 "微星 GeForce…"。
    // 若检索只匹配 name/aliases，中文用户就一条都搜不到。
    const entries: CatalogEntry[] = [
      {
        id: "gpu-msi-3050",
        category: "gpu",
        name: "MSI GeForce RTX 3050 AERO ITX 8GB OC",
        aliases: [],
        spec: {},
      },
      {
        id: "mb-asus-b850a",
        category: "motherboard",
        name: "ROG STRIX B850-A GAMING WIFI7 S NEO",
        nameZh: "ROG STRIX B850-A GAMING WIFI7 S NEO 吹雪",
        aliases: [],
        spec: {},
      },
    ];
    // 推导出的厂商中文名
    expect(searchCatalog(entries, "gpu", "微星").map((e) => e.id)).toContain("gpu-msi-3050");
    // 官网中文名
    expect(searchCatalog(entries, "motherboard", "吹雪").map((e) => e.id)).toContain("mb-asus-b850a");
    // 英文原名仍然可搜（不能因为本地化就把英文检索能力弄丢）
    expect(searchCatalog(entries, "gpu", "MSI GeForce").map((e) => e.id)).toContain("gpu-msi-3050");
  });

  it("界面上可见的字一律搜得到——含被截断的规格参数", () => {
    // 界面可能显示截断版，也可能因同类别撞车显示完整版；
    // 两种模式下出现的字符都必须可搜，否则用户看到却找不到。
    const entries: CatalogEntry[] = [
      {
        id: "ram-1",
        category: "ram",
        name: "Kingston FURY Beast 6000MT/s 32GB (2x16GB) DDR5 Black",
        aliases: [],
        spec: {},
      },
    ];
    for (const q of ["6000MT/s", "32GB", "DDR5", "金士顿", "FURY"]) {
      expect(searchCatalog(entries, "ram", q).map((e) => e.id)).toContain("ram-1");
    }
  });

  it("按 id 查找并校验类别一致", () => {
    const entry = findCatalogEntry(CATALOG, "gpu", "gpu-rtx4090");
    expect(entry?.name).toContain("4090");
    expect(findCatalogEntry(CATALOG, "cpu", "gpu-rtx4090")).toBeUndefined();
  });
});
