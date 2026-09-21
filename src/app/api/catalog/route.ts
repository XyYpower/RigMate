import { NextResponse } from "next/server";
import { buildItemCategorySchema } from "@/domain/build/types";
import { CATALOG } from "@/domain/catalog/seed";
import { searchCatalog } from "@/domain/catalog/search";

/** 标准型号目录检索：GET /api/catalog?category=cpu&q=9800 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = buildItemCategorySchema.safeParse(url.searchParams.get("category"));
  if (!category.success) {
    return NextResponse.json({ error: "无效或缺失的配件类别。" }, { status: 400 });
  }
  const q = url.searchParams.get("q");
  return NextResponse.json({ entries: searchCatalog(CATALOG, category.data, q) });
}
