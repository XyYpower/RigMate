import { NextResponse } from "next/server";
import { buildCatalogOverview, buildQualityOverview, type CatalogSourceKey } from "@/domain/catalog/overview";
import { CATALOG } from "@/domain/catalog/seed";
import { loadBuildcoresCatalog, loadManualCatalog } from "@/infra/catalog-import/load";
import { listCatalogImportRuns } from "@/infra/db/repositories/catalog-import-repository";
import { listCatalogQualityRows } from "@/infra/db/repositories/catalog-repository";
import { evidenceCoverageStats } from "@/infra/db/repositories/evidence-repository";
import { listQueueItems } from "@/infra/db/repositories/quality-repository";

/** 硬件中心总览：GET /api/catalog/overview
 *  三层目录来源计数、按类别规格覆盖、最近导入审计 + 目录质量只读报表（Task 6）。
 *  无副作用，纯读。 */
export async function GET() {
  const manual = loadManualCatalog();
  const buildcores = loadBuildcoresCatalog();

  const sources = [
    {
      key: "seed" as CatalogSourceKey,
      label: "人工种子",
      entries: CATALOG,
      importedAt: null,
      note: "随代码维护的高频型号（src/domain/catalog/seed.ts）",
      attribution: null,
    },
    {
      key: "manual" as CatalogSourceKey,
      label: "人工整理",
      entries: manual?.entries ?? [],
      importedAt: manual?.provenance.importedAt ?? null,
      note: manual?.provenance.note ?? null,
      attribution: null,
    },
    {
      key: "buildcores" as CatalogSourceKey,
      label: "BuildCores OpenDB",
      entries: buildcores?.entries ?? [],
      importedAt: buildcores?.provenance.importedAt ?? null,
      note: null,
      attribution: buildcores
        ? {
            upstreamCommit: buildcores.provenance.upstreamCommit,
            upstreamUrl: buildcores.provenance.upstreamUrl,
            license: buildcores.provenance.license,
            licenseUrl: buildcores.provenance.licenseUrl,
          }
        : null,
    },
  ];

  return NextResponse.json({
    overview: buildCatalogOverview(sources),
    imports: listCatalogImportRuns(20),
    quality: buildQualityOverview({
      records: listCatalogQualityRows(),
      queueItems: listQueueItems({ limit: 1000 }),
      evidence: evidenceCoverageStats(),
    }),
  });
}
