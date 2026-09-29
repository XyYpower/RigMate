import { describe, expect, it } from "vitest";
import { auditCatalog, type AuditableCatalogEntry } from "@/domain/catalog/audit";

describe("auditCatalog", () => {
  it("reports required field coverage by category and source", () => {
    const entries: AuditableCatalogEntry[] = [
      { id: "cpu-1", category: "cpu", name: "CPU 1", aliases: ["c1"], spec: { socket: "AM5", tdpWatts: 65 }, source: "seed" },
      { id: "mb-1", category: "motherboard", name: "Board 1", aliases: [], spec: { socket: "AM5" }, source: "buildcores" },
    ];

    const report = auditCatalog(entries);

    expect(report.byCategory.cpu.complete).toBe(1);
    expect(report.byCategory.motherboard.complete).toBe(0);
    expect(report.byCategory.motherboard.missing.ramType).toBe(1);
    expect(report.bySource.buildcores.withoutAliases).toBe(1);
  });

  it("reports duplicate normalized names without merging records", () => {
    const entries: AuditableCatalogEntry[] = [
      { id: "a", category: "cpu", name: "AMD Ryzen 7 7800X3D", aliases: [], spec: {}, source: "seed" },
      { id: "b", category: "cpu", name: "amd  ryzen 7 7800x3d", aliases: [], spec: {}, source: "buildcores" },
    ];

    const report = auditCatalog(entries);

    expect(report.duplicateNames).toEqual([{ category: "cpu", normalizedName: "amd ryzen 7 7800x3d", count: 2, ids: ["a", "b"] }]);
  });
});
