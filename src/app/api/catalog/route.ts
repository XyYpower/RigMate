import { NextResponse } from "next/server";
import { buildItemCategorySchema } from "@/domain/build/types";
import { CATALOG } from "@/domain/catalog/seed";
import { searchCatalog } from "@/domain/catalog/search";
import type { CatalogEntry } from "@/domain/catalog/seed";
import { loadBuildcoresCatalog, loadManualCatalog } from "@/infra/catalog-import/load";

/** 标准型号目录检索：GET /api/catalog?category=cpu&q=9800
 *  返回 entries（三层合并：种子→人工→BuildCores，附带 source 标记）与 provenance（未导入时为 null） */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = buildItemCategorySchema.safeParse(url.searchParams.get("category"));
  if (!category.success) {
    return NextResponse.json({ error: "无效或缺失的配件类别。" }, { status: 400 });
  }
  const q = url.searchParams.get("q");

  const manual = loadManualCatalog();
  const buildcores = loadBuildcoresCatalog();
  const tagged: (CatalogEntry & { source: string })[] = [
    ...CATALOG.map((entry) => ({ ...entry, source: "seed" })),
    ...(manual?.entries ?? []).map((entry) => ({ ...entry, source: "manual" })),
    ...(buildcores?.entries ?? []).map((entry) => ({ ...entry, source: "buildcores" })),
  ];

  return NextResponse.json({
    entries: searchCatalog(tagged, category.data, q),
    provenance: buildcores?.provenance ?? null,
  });
}
