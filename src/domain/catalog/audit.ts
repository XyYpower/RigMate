import type { BuildItemCategory } from "@/domain/build/types";

export type CatalogAuditSource = "seed" | "manual" | "buildcores" | "zol";
export type AuditableCatalogEntry = { id: string; category: BuildItemCategory; name: string; aliases: string[]; spec: Record<string, unknown>; source: CatalogAuditSource };

const REQUIRED_FIELDS: Record<BuildItemCategory, string[]> = {
  cpu: ["socket", "tdpWatts"],
  motherboard: ["socket", "ramType", "formFactor", "ramSlots", "m2Slots", "sataPorts", "pcieX16Slots"],
  gpu: ["lengthMm", "tdpWatts", "pcie8pin", "twelveVhpwr"],
  ram: ["ddrType", "sticks"],
  storage: ["interface"],
  psu: ["ratedWatts", "pcie8pin", "twelveVhpwr"],
  cooler: ["supportedSockets", "heightMm"],
  case: ["supportedFormFactors", "maxGpuLengthMm", "maxCoolerHeightMm"],
};

export type CategoryAudit = { total: number; complete: number; missing: Record<string, number> };
export type SourceAudit = { total: number; withoutAliases: number };
export type CatalogAuditReport = {
  total: number;
  byCategory: Record<BuildItemCategory, CategoryAudit>;
  bySource: Record<CatalogAuditSource, SourceAudit>;
  duplicateNames: Array<{ category: BuildItemCategory; normalizedName: string; count: number; ids: string[] }>;
};

function createCategoryAudit(): CategoryAudit { return { total: 0, complete: 0, missing: {} }; }
function createSourceAudit(): SourceAudit { return { total: 0, withoutAliases: 0 }; }

export function normalizeCatalogName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function auditCatalog(entries: AuditableCatalogEntry[]): CatalogAuditReport {
  const categories = Object.keys(REQUIRED_FIELDS) as BuildItemCategory[];
  const sources: CatalogAuditSource[] = ["seed", "manual", "buildcores", "zol"];
  const byCategory = Object.fromEntries(categories.map((category) => [category, createCategoryAudit()])) as Record<BuildItemCategory, CategoryAudit>;
  const bySource = Object.fromEntries(sources.map((source) => [source, createSourceAudit()])) as Record<CatalogAuditSource, SourceAudit>;
  const names = new Map<string, { category: BuildItemCategory; ids: string[] }>();
  for (const entry of entries) {
    const category = byCategory[entry.category];
    category.total += 1;
    const missing = REQUIRED_FIELDS[entry.category].filter((field) => entry.spec[field] === undefined || entry.spec[field] === null);
    if (missing.length === 0) category.complete += 1;
    for (const field of missing) category.missing[field] = (category.missing[field] ?? 0) + 1;
    const source = bySource[entry.source];
    source.total += 1;
    if (entry.aliases.length === 0) source.withoutAliases += 1;
    const key = entry.category + "\0" + normalizeCatalogName(entry.name);
    const existing = names.get(key);
    if (existing) existing.ids.push(entry.id); else names.set(key, { category: entry.category, ids: [entry.id] });
  }
  const duplicateNames = [...names.entries()]
    .filter(([, value]) => value.ids.length > 1)
    .map(([key, value]) => ({ category: value.category, normalizedName: key.slice(key.indexOf("\0") + 1), count: value.ids.length, ids: [...value.ids].sort() }))
    .sort((a, b) => b.count - a.count || a.normalizedName.localeCompare(b.normalizedName));
  return { total: entries.length, byCategory, bySource, duplicateNames };
}
