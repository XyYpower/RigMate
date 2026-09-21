import { NextResponse } from "next/server";
import { buildItemCategorySchema } from "@/domain/build/types";
import { CATALOG } from "@/domain/catalog/seed";
import { searchCatalog } from "@/domain/catalog/search";
import { loadBuildcoresCatalog, mergedCatalogEntries } from "@/infra/catalog-import/load";

/** 标准型号目录检索：GET /api/catalog?category=cpu&q=9800
 *  返回 entries（人工种子 + BuildCores 导入条目）与 provenance（未导入时为 null） */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = buildItemCategorySchema.safeParse(url.searchParams.get("category"));
  if (!category.success) {
    return NextResponse.json({ error: "无效或缺失的配件类别。" }, { status: 400 });
  }
  const q = url.searchParams.get("q");
  return NextResponse.json({
    entries: searchCatalog(mergedCatalogEntries(CATALOG), category.data, q),
    provenance: loadBuildcoresCatalog()?.provenance ?? null,
  });
}
