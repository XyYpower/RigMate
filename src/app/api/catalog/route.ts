import { NextResponse } from "next/server";
import { buildItemCategorySchema } from "@/domain/build/types";
import { searchCatalog } from "@/domain/catalog/search";
import { decorateCatalogEntries } from "@/infra/catalog-import/display-names";
import { loadBuildcoresCatalog, loadSourcedCatalog } from "@/infra/catalog-import/load";

/** 标准型号目录检索：GET /api/catalog?category=cpu&q=9800
 *  自有规格库（canonical_products）优先；库为空时回退三层 JSON 合并。
 *  entries 附 source 标记、refUrl（商品页链接，可选）与中文展示名
 *  （displayName 优先中文、displayNameOriginal 为英文原名；两者都原样保留 name 供溯源），
 *  provenance 为 BuildCores 署名（未导入时 null）。 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = buildItemCategorySchema.safeParse(url.searchParams.get("category"));
  if (!category.success) {
    return NextResponse.json({ error: "无效或缺失的配件类别。" }, { status: 400 });
  }
  const q = url.searchParams.get("q");

  const { entries } = loadSourcedCatalog();
  return NextResponse.json({
    entries: decorateCatalogEntries(searchCatalog(entries, category.data, q)),
    provenance: loadBuildcoresCatalog()?.provenance ?? null,
  });
}
