import { createHash } from "node:crypto";
import type { CatalogEntry } from "@/domain/catalog/seed";
import { isValidSpecFieldValue } from "@/domain/catalog/quality";
import {
  getCatalogSnapshot,
  upsertCatalogEntries,
  writeCatalogMerge,
} from "@/infra/db/repositories/catalog-repository";
import { addFieldEvidence, addProductSource } from "@/infra/db/repositories/evidence-repository";
import { appendQualityEvent } from "@/infra/db/repositories/quality-repository";

/**
 * BuildCores → canonical_products 审计合并（DATA_OPERATIONS_PLAYBOOK §3、实施计划 Task 3）。
 *
 * 纪律：
 * - 首次见到的 id 才允许建条目（partial 起步）；已有一律**只补缺**，绝不覆盖已核值；
 * - 同字段值冲突：不覆盖旧值，上游值作为证据追加留痕，写 conflict 质量事件并把产品状态降级 conflicting；
 * - 每条被触碰的条目登记一行 product_sources（S2、unreviewed，内容哈希 = 单条记录哈希）；
 *   补缺的字段逐个落 product_field_evidence——没有证据链的字段不可能进入 verified/supported；
 * - 首次插入的批量条目不落逐字段证据（26k 全量场景），证据链从"补缺/冲突"开始积累。
 */

export type BuildcoresBatchProvenance = {
  upstreamCommit: string;
  upstreamUrl: string;
  license: string;
  sourcePath: string;
};

export type BuildcoresBatchReport = {
  total: number;
  /** 新建条目数（partial 起步） */
  inserted: number;
  /** 发生补缺的产品数 / 补缺字段数 */
  filledProducts: number;
  filledFields: number;
  /** 发生冲突被降级 conflicting 的产品数 / 冲突字段数 */
  conflictedProducts: number;
  conflictedFields: number;
  /** 与库内完全一致的字段数 */
  unchangedFields: number;
  /** 被 schema 拒绝的上游字段数（未知字段或坏值，门口弹回） */
  rejectedFields: number;
  sourcesCreated: number;
  eventsAppended: number;
  contentHash: string;
};

function entryContentHash(entry: CatalogEntry): string {
  return createHash("sha256")
    .update(JSON.stringify({ id: entry.id, category: entry.category, name: entry.name, spec: entry.spec }))
    .digest("hex");
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => valuesEqual(item, b[index]));
  }
  return a === b;
}

export function importBuildcoresBatch(
  entries: CatalogEntry[],
  provenance: BuildcoresBatchProvenance,
): BuildcoresBatchReport {
  const report: BuildcoresBatchReport = {
    total: entries.length,
    inserted: 0,
    filledProducts: 0,
    filledFields: 0,
    conflictedProducts: 0,
    conflictedFields: 0,
    unchangedFields: 0,
    rejectedFields: 0,
    sourcesCreated: 0,
    eventsAppended: 0,
    contentHash: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  };
  const now = new Date().toISOString();

  for (const entry of entries) {
    const snapshot = getCatalogSnapshot(entry.id);

    if (!snapshot) {
      const result = upsertCatalogEntries([
        { ...entry, source: "buildcores", sourceVersion: provenance.upstreamCommit },
      ]);
      if (result.inserted === 0) continue; // 并发下被别人先建，按已存在处理
      report.inserted += 1;
      appendQualityEvent({
        canonicalProductId: entry.id,
        eventType: "imported",
        beforeJson: null,
        afterJson: { spec: entry.spec, upstreamCommit: provenance.upstreamCommit },
        reason: `BuildCores 首次导入（${entry.name}）`,
        actor: "import:buildcores",
        createdAt: now,
      });
      report.eventsAppended += 1;
      continue;
    }

    const source = addProductSource({
      canonicalProductId: entry.id,
      sourceType: "buildcores",
      tier: "S2",
      sourceUrl: provenance.upstreamUrl,
      sourceTitle: `BuildCores OpenDB（${entry.name}）`,
      sourceVersion: provenance.upstreamCommit,
      license: provenance.license,
      capturedAt: now,
      contentHash: entryContentHash(entry),
      status: "unreviewed",
      reviewerNote: null,
    });
    report.sourcesCreated += 1;

    const mergedSpec: Record<string, unknown> = { ...snapshot.spec };
    let filled = 0;
    let conflicted = 0;
    for (const [field, value] of Object.entries(entry.spec)) {
      const current = snapshot.spec[field];
      if (current === undefined || current === null) {
        if (!isValidSpecFieldValue(snapshot.category, field, value)) {
          report.rejectedFields += 1;
          continue;
        }
        mergedSpec[field] = value;
        filled += 1;
        addFieldEvidence({
          canonicalProductId: entry.id,
          fieldPath: `spec.${field}`,
          sourceId: source.id,
          value,
          excerpt: `BuildCores ${provenance.upstreamCommit.slice(0, 12)}：${entry.name} · ${field}=${JSON.stringify(value)}`,
          // 同 canonical id 的上游记录：身份由目录对齐（非 MPN 级），字段封顶 supported
          identityMatch: "fields_matched",
          confidence: "medium",
          verifiedAt: null,
          verifiedBy: null,
          supersedesId: null,
        });
      } else if (!valuesEqual(current, value)) {
        conflicted += 1;
        addFieldEvidence({
          canonicalProductId: entry.id,
          fieldPath: `spec.${field}`,
          sourceId: source.id,
          value,
          excerpt: `BuildCores ${provenance.upstreamCommit.slice(0, 12)}：${entry.name} · ${field}=${JSON.stringify(value)}（与库内冲突）`,
          identityMatch: "fields_matched",
          confidence: "medium",
          verifiedAt: null,
          verifiedBy: null,
          supersedesId: null,
        });
        appendQualityEvent({
          canonicalProductId: entry.id,
          eventType: "conflict",
          beforeJson: { [field]: current },
          afterJson: { [field]: value },
          reason: `BuildCores ${provenance.upstreamCommit.slice(0, 12)} 与库内值冲突：spec.${field}`,
          actor: "import:buildcores",
          createdAt: now,
        });
        report.eventsAppended += 1;
      } else {
        report.unchangedFields += 1;
      }
    }

    if (filled > 0 || conflicted > 0) {
      const nextStatus = conflicted > 0 ? "conflicting" : snapshot.qualityStatus;
      writeCatalogMerge(entry.id, mergedSpec, nextStatus, provenance.upstreamCommit);
      if (filled > 0) {
        report.filledProducts += 1;
        report.filledFields += filled;
      }
      if (conflicted > 0) {
        report.conflictedProducts += 1;
        report.conflictedFields += conflicted;
      }
    }
  }

  return report;
}
