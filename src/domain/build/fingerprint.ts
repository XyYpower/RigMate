import type { BuildItem } from "./types";

export function itemsFingerprint(items: BuildItem[]): string {
  return JSON.stringify(
    [...items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        category: item.category,
        label: item.label,
        spec: item.spec,
        source: item.source ?? null,
      })),
  );
}
