import { NextResponse } from "next/server";
import { buildItemCategorySchema } from "@/domain/build/types";
import { searchCatalog } from "@/domain/catalog/search";
import { loadBuildcoresCatalog, loadSourcedCatalog } from "@/infra/catalog-import/load";

/** 标准型号目录检索：GET /api/catalog?category=cpu&q=9800
 *  自有规格库（canonical_products）优先；库为空时回退三层 JSON 合并。
 *  entries 附 source 标记与 refUrl（商品页链接，可选），provenance 为 BuildCores 署名（未导入时 null）。 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = buildItemCategorySchema.safeParse(url.searchParams.get("category"));
  if (!category.success) {
    return NextResponse.json({ error: "无效或缺失的配件类别。" }, { status: 400 });
  }
  const q = url.searchParams.get("q");

  const { entries } = loadSourcedCatalog();
  return NextResponse.json({
    entries: searchCatalog(entries, category.data, q),
    provenance: loadBuildcoresCatalog()?.provenance ?? null,
  });
}
