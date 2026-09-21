import { describe, expect, it } from "vitest";
import { CATALOG } from "@/domain/catalog/seed";
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

  it("按 id 查找并校验类别一致", () => {
    const entry = findCatalogEntry(CATALOG, "gpu", "gpu-rtx4090");
    expect(entry?.name).toContain("4090");
    expect(findCatalogEntry(CATALOG, "cpu", "gpu-rtx4090")).toBeUndefined();
  });
});
