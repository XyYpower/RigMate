import type { PublishStatus } from "@/domain/catalog/quality";
import {
  computeFieldQuality,
  computeProductQualityStatus,
  isRuleUsable,
  requiredFieldsOf,
  type FieldEvidenceFact,
  type FieldQualityResult,
  type SourceTier,
} from "@/domain/catalog/quality";
import type { BuildItemCategory } from "@/domain/build/types";
import type { EvidenceStatus, IdentityMatch } from "@/domain/catalog/quality";
import type { ProductFieldEvidence, ProductSource, ProductSourceType } from "@/contracts/catalog";
import {
  getCatalogSnapshot,
  setProductMergedInto,
  writeCatalogMerge,
} from "@/infra/db/repositories/catalog-repository";
import {
  addFieldEvidence,
  addProductSource,
  findFieldEvidence,
  findProductSourceOwner,
  listFieldEvidence,
  listProductSources,
  reattachProductDataTo,
  transitionProductSourceStatus,
  verifyFieldEvidence,
} from "@/infra/db/repositories/evidence-repository";
import {
  appendQualityEvent,
  createQueueItem,
  listQueueItems,
  updateQueueItem,
} from "@/infra/db/repositories/quality-repository";

/**
 * 目录审核服务（实施计划 Task 4，PLAYBOOK §6/§7/§8）。
 *
 * 纪律：
 * - **所有写操作必须署名 reviewer（人工）**——这是"Agent 无权直接发布 verified"的机制保证：
 *   产品质量状态只能由本服务按证据链重算后持久化，导入器与 Agent 路径都到不了这里；
 * - 每次变更追加 data_quality_event（before/after/reason/actor/createdAt），事件只增不改；
 * - 证据行的计算状态由「来源状态 + 人工复核盖章」推导：来源 rejected → 证据作废，来源 stale → 证据过期，
 *   来源 conflicting → 证据视同未复核，其余按 verifiedAt 是否盖章算 verified/unreviewed；
 * - publish 不引入任何新事实，只是把"证据算出来的状态"落库并盖章留痕。
 */

export class CatalogReviewError extends Error {}

function requireReviewer(reviewer: string | undefined | null): string {
  const name = reviewer?.trim();
  if (!name) {
    throw new CatalogReviewError("人工操作必须署名 reviewer（Agent 无权直接变更产品事实）");
  }
  return name;
}

function requireLiveProduct(canonicalProductId: string): NonNullable<ReturnType<typeof getCatalogSnapshot>> {
  const snapshot = getCatalogSnapshot(canonicalProductId);
  if (!snapshot) throw new CatalogReviewError(`产品不存在：${canonicalProductId}（新品请走 new_product 队列）`);
  if (snapshot.mergedInto) {
    throw new CatalogReviewError(`产品已合并入 ${snapshot.mergedInto}，请操作保留条目`);
  }
  return snapshot;
}

/** 来源状态 + 复核盖章 → 质量计算用的事实状态（见文件头推导规则） */
function deriveFactStatus(sourceStatus: EvidenceStatus, verifiedAt: string | null): EvidenceStatus {
  if (sourceStatus === "rejected") return "rejected";
  if (sourceStatus === "stale") return "stale";
  if (sourceStatus === "conflicting") return "unreviewed";
  return verifiedAt ? "verified" : "unreviewed";
}

type FactBundle = {
  category: BuildItemCategory;
  /** fieldPath（"spec.lengthMm"）→ 计算事实 */
  byFieldPath: Map<string, FieldEvidenceFact[]>;
};

function loadFactBundle(canonicalProductId: string): FactBundle {
  const sources = new Map(listProductSources(canonicalProductId).map((source) => [source.id, source]));
  const byFieldPath = new Map<string, FieldEvidenceFact[]>();
  for (const evidence of listFieldEvidence(canonicalProductId)) {
    const source = sources.get(evidence.sourceId);
    if (!source) continue;
    const fact: FieldEvidenceFact = {
      id: evidence.id,
      value: evidence.value,
      tier: source.tier as SourceTier,
      identityMatch: evidence.identityMatch as IdentityMatch,
      status: deriveFactStatus(source.status as EvidenceStatus, evidence.verifiedAt),
      capturedAt: source.capturedAt,
      supersedesId: evidence.supersedesId,
    };
    const bucket = byFieldPath.get(evidence.fieldPath);
    if (bucket) bucket.push(fact);
    else byFieldPath.set(evidence.fieldPath, [fact]);
  }
  const category = getCatalogSnapshot(canonicalProductId)!.category;
  return { category, byFieldPath };
}

export type ProductFieldStatusReport = {
  canonicalProductId: string;
  category: BuildItemCategory;
  /** 必填字段 → 判定结果（状态/采用值/原因/冲突情况/排除明细） */
  fields: Record<string, FieldQualityResult>;
  productStatus: PublishStatus;
};

/** 按证据链重算产品的全部必填字段状态与产品级状态（publish 与 UI 共用） */
export function computeProductFieldStatuses(canonicalProductId: string): ProductFieldStatusReport {
  const snapshot = requireLiveProduct(canonicalProductId);
  const bundle = loadFactBundle(canonicalProductId);
  const fields: Record<string, FieldQualityResult> = {};
  const statuses: Record<string, FieldQualityResult["status"]> = {};
  for (const field of requiredFieldsOf(snapshot.category)) {
    const result = computeFieldQuality(
      snapshot.category,
      field,
      bundle.byFieldPath.get(`spec.${field}`) ?? [],
    );
    fields[field] = result;
    statuses[field] = result.status;
  }
  return {
    canonicalProductId,
    category: snapshot.category,
    fields,
    productStatus: computeProductQualityStatus(statuses),
  };
}

/**
 * 内核恢复计划 Task A：方案候选的质量层。
 * 只返回**有证据事实**的字段状态——没有证据的字段不进映射（保留"无质量层"语义，
 * 规则引擎按历史行为处理），避免把无证据字段误判成 unknown 而阻断本可用的规则。
 * evidenceSourceIds 为该产品证据引用到的来源 id（product_sources.id），随方案项透出以便回溯。
 */
export function computeEvidenceBackedFieldStatuses(canonicalProductId: string): {
  fieldQuality: Record<string, FieldQualityResult["status"]>;
  evidenceSourceIds: string[];
} {
  const snapshot = requireLiveProduct(canonicalProductId);
  const bundle = loadFactBundle(canonicalProductId);
  const fieldQuality: Record<string, FieldQualityResult["status"]> = {};
  for (const [fieldPath, facts] of bundle.byFieldPath) {
    if (facts.length === 0) continue;
    const fieldName = fieldPath.replace(/^spec\./, "");
    fieldQuality[fieldName] = computeFieldQuality(snapshot.category, fieldName, facts).status;
  }
  const evidenceSourceIds = [
    ...new Set(listFieldEvidence(canonicalProductId).map((evidence) => evidence.sourceId)),
  ];
  return { fieldQuality, evidenceSourceIds };
}

// ---- 来源与证据操作 ----

export type AddReviewSourceInput = {
  canonicalProductId: string;
  sourceType: ProductSourceType;
  tier: SourceTier;
  sourceUrl: string;
  sourceTitle: string;
  sourceVersion?: string | null;
  license?: string | null;
  contentHash: string;
  capturedAt?: string;
  reviewer: string;
};

export function addReviewSource(input: AddReviewSourceInput): ProductSource {
  requireReviewer(input.reviewer);
  requireLiveProduct(input.canonicalProductId);
  return addProductSource({
    canonicalProductId: input.canonicalProductId,
    sourceType: input.sourceType,
    tier: input.tier,
    sourceUrl: input.sourceUrl,
    sourceTitle: input.sourceTitle,
    sourceVersion: input.sourceVersion ?? null,
    license: input.license ?? null,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    contentHash: input.contentHash,
    status: "unreviewed",
    reviewerNote: null,
  });
}

export type AddReviewEvidenceInput = {
  canonicalProductId: string;
  fieldPath: string;
  sourceId: string;
  value: unknown;
  excerpt: string;
  identityMatch: IdentityMatch;
  confidence?: "high" | "medium" | "low";
  /** 本条证据取代的旧证据 id（来源升级链：官网一手取代聚合转载） */
  supersedesId?: string | null;
  reviewer: string;
};

/** 录入字段证据：仓储过 schema 门，随后重算字段状态并留痕 */
export function addReviewEvidence(input: AddReviewEvidenceInput): {
  evidence: ProductFieldEvidence;
  field: FieldQualityResult;
} {
  requireReviewer(input.reviewer);
  requireLiveProduct(input.canonicalProductId);
  const fieldName = input.fieldPath.replace(/^spec\./, "");
  const before = computeProductFieldStatuses(input.canonicalProductId);
  const evidence = addFieldEvidence({
    canonicalProductId: input.canonicalProductId,
    fieldPath: input.fieldPath,
    sourceId: input.sourceId,
    value: input.value,
    excerpt: input.excerpt,
    identityMatch: input.identityMatch,
    confidence: input.confidence ?? "medium",
    verifiedAt: null,
    verifiedBy: null,
    supersedesId: input.supersedesId ?? null,
  });
  const after = computeProductFieldStatuses(input.canonicalProductId);
  appendQualityEvent({
    canonicalProductId: input.canonicalProductId,
    eventType: "corrected",
    beforeJson: { [fieldName]: before.fields[fieldName]?.status ?? null },
    afterJson: { [fieldName]: after.fields[fieldName]?.status ?? null, evidenceId: evidence.id },
    reason: `录入字段证据：${input.excerpt.slice(0, 120)}`,
    actor: `reviewer:${input.reviewer}`,
  });
  return { evidence, field: after.fields[fieldName] };
}

/** 人工复核证据：盖章 verifiedAt/verifiedBy，来源未复核的一并转 verified，随后重算 */
export function verifyReviewEvidence(input: {
  evidenceId: string;
  reviewer: string;
  note?: string;
}): ProductFieldStatusReport {
  const reviewer = requireReviewer(input.reviewer);
  const evidence = findFieldEvidence(input.evidenceId);
  if (!evidence) throw new CatalogReviewError(`证据不存在：${input.evidenceId}`);
  const before = computeProductFieldStatuses(evidence.canonicalProductId);
  verifyFieldEvidence(evidence.id, reviewer);
  const source = listProductSources(evidence.canonicalProductId).find((item) => item.id === evidence.sourceId);
  if (source && source.status === "unreviewed") {
    transitionProductSourceStatus(source.id, "verified", input.note ?? `随证据 ${evidence.id} 人工复核`);
  }
  const after = computeProductFieldStatuses(evidence.canonicalProductId);
  appendQualityEvent({
    canonicalProductId: evidence.canonicalProductId,
    eventType: "reviewed",
    beforeJson: before.fields,
    afterJson: after.fields,
    reason: input.note?.trim() || "人工复核字段证据",
    actor: `reviewer:${reviewer}`,
  });
  return after;
}

/** 来源审核流转：verified / conflicting / stale / rejected（状态机在仓储层把关） */
export function reviewSourceStatus(input: {
  sourceId: string;
  status: Exclude<EvidenceStatus, "unreviewed">;
  reviewer: string;
  note?: string;
}): ProductFieldStatusReport {
  const reviewer = requireReviewer(input.reviewer);
  const canonicalProductId = findProductSourceOwner(input.sourceId);
  if (!canonicalProductId) throw new CatalogReviewError(`来源不存在：${input.sourceId}`);
  const before = computeProductFieldStatuses(canonicalProductId);
  const source = transitionProductSourceStatus(input.sourceId, input.status, input.note);
  const after = computeProductFieldStatuses(canonicalProductId);
  appendQualityEvent({
    canonicalProductId,
    eventType: input.status === "rejected" || input.status === "stale" ? "deprecated" : "reviewed",
    beforeJson: { fields: before.fields },
    afterJson: { sourceStatus: source.status, fields: after.fields },
    reason: input.note?.trim() || `来源状态 → ${input.status}`,
    actor: `reviewer:${reviewer}`,
  });
  return after;
}

/** 标记过期：该产品全部可用来源转 stale，产品状态置 stale（禁止作为最新事实） */
export function markProductStale(input: {
  canonicalProductId: string;
  reviewer: string;
  reason: string;
}): ProductFieldStatusReport {
  const reviewer = requireReviewer(input.reviewer);
  const snapshot = requireLiveProduct(input.canonicalProductId);
  if (!input.reason.trim()) throw new CatalogReviewError("标记过期必须说明原因");
  const before = computeProductFieldStatuses(snapshot.id);
  for (const source of listProductSources(snapshot.id)) {
    if (source.status === "stale" || source.status === "rejected") continue;
    try {
      transitionProductSourceStatus(source.id, "stale", input.reason);
    } catch {
      // 个别来源状态机不允许直达 stale 时跳过，不影响整体标记
    }
  }
  writeCatalogMerge(snapshot.id, snapshot.spec, "stale", null);
  const after = computeProductFieldStatuses(snapshot.id);
  appendQualityEvent({
    canonicalProductId: snapshot.id,
    eventType: "deprecated",
    beforeJson: { productStatus: before.productStatus },
    afterJson: { productStatus: "stale" },
    reason: input.reason,
    actor: `reviewer:${reviewer}`,
  });
  return after;
}

/** 发布：按证据链重算，把采用值**补缺**写回 spec（绝不覆盖已有值）并落产品质量状态 */
export function publishProduct(input: {
  canonicalProductId: string;
  reviewer: string;
  note?: string;
}): ProductFieldStatusReport {
  const reviewer = requireReviewer(input.reviewer);
  const snapshot = requireLiveProduct(input.canonicalProductId);
  const report = computeProductFieldStatuses(snapshot.id);
  // 采用值补缺：字段状态可用（verified/supported）且证据有采用值、spec 尚缺时写入；
  // 已有值不覆盖（纠错走 corrected 流程由人工执行），冲突/无证据字段不带值
  const nextSpec: Record<string, unknown> = { ...snapshot.spec };
  let adopted = 0;
  for (const [field, result] of Object.entries(report.fields)) {
    if (
      nextSpec[field] === undefined &&
      isRuleUsable(result.status) &&
      result.value !== undefined
    ) {
      nextSpec[field] = result.value;
      adopted += 1;
    }
  }
  writeCatalogMerge(snapshot.id, nextSpec, report.productStatus, null);
  appendQualityEvent({
    canonicalProductId: snapshot.id,
    eventType: "reviewed",
    beforeJson: { productStatus: snapshot.qualityStatus, spec: snapshot.spec },
    afterJson: {
      productStatus: report.productStatus,
      spec: nextSpec,
      adoptedFields: adopted,
      fields: Object.fromEntries(Object.entries(report.fields).map(([field, result]) => [field, result.status])),
    },
    reason: input.note?.trim() || `发布字段质量状态${adopted > 0 ? `，补缺 ${adopted} 个字段` : ""}`,
    actor: `reviewer:${reviewer}`,
  });
  return report;
}

/**
 * 证据更正：按当前证据链重算，把「判定干净（无未解决冲突）且可用」的字段值**覆盖**写入 spec。
 * 与 publish 的补缺相对：publish 只填空位，本操作用于"已有值与更高等级证据不一致"的纠错
 * （如聚合约值被官网精确值取代）。更正前后全部留痕（eventType=corrected），复核兜底走人工盖章。
 */
export function correctProductFromEvidence(input: {
  canonicalProductId: string;
  reviewer: string;
  reason: string;
}): { report: ProductFieldStatusReport; corrections: Array<{ field: string; before: unknown; after: unknown }> } {
  const reviewer = requireReviewer(input.reviewer);
  const snapshot = requireLiveProduct(input.canonicalProductId);
  if (!input.reason.trim()) throw new CatalogReviewError("证据更正必须说明原因");
  const report = computeProductFieldStatuses(snapshot.id);
  const nextSpec: Record<string, unknown> = { ...snapshot.spec };
  const corrections: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const [field, result] of Object.entries(report.fields)) {
    if (
      result.conflict !== "unresolved" &&
      isRuleUsable(result.status) &&
      result.value !== undefined &&
      JSON.stringify(nextSpec[field]) !== JSON.stringify(result.value)
    ) {
      corrections.push({ field, before: nextSpec[field] ?? null, after: result.value });
      nextSpec[field] = result.value;
    }
  }
  if (corrections.length === 0) {
    return { report, corrections };
  }
  writeCatalogMerge(snapshot.id, nextSpec, report.productStatus, null);
  appendQualityEvent({
    canonicalProductId: snapshot.id,
    eventType: "corrected",
    beforeJson: { spec: snapshot.spec },
    afterJson: { spec: nextSpec, corrections },
    reason: input.reason,
    actor: `reviewer:${reviewer}`,
  });
  return { report, corrections };
}

/** 合并去重：证据与来源改挂保留条目 → 补缺 → 重算状态 → 旧 id 记 merged_into（可解析，不进候选） */
export function mergeProducts(input: {
  keepId: string;
  duplicateId: string;
  reviewer: string;
  reason: string;
}): ProductFieldStatusReport {
  const reviewer = requireReviewer(input.reviewer);
  if (!input.reason.trim()) throw new CatalogReviewError("合并必须说明原因（PLAYBOOK §7）");
  if (input.keepId === input.duplicateId) throw new CatalogReviewError("不能把条目合并进它自己");
  const keep = requireLiveProduct(input.keepId);
  const duplicate = requireLiveProduct(input.duplicateId);
  if (keep.category !== duplicate.category) {
    throw new CatalogReviewError(`类别不同，禁止合并：${keep.category} vs ${duplicate.category}`);
  }

  const beforeSpec = keep.spec;
  const reattached = reattachProductDataTo(duplicate.id, keep.id);
  const mergedSpec: Record<string, unknown> = { ...keep.spec };
  let filled = 0;
  for (const [field, value] of Object.entries(duplicate.spec)) {
    if (mergedSpec[field] === undefined || mergedSpec[field] === null) {
      mergedSpec[field] = value;
      filled += 1;
    }
  }
  setProductMergedInto(duplicate.id, keep.id);
  const report = computeProductFieldStatuses(keep.id);
  writeCatalogMerge(keep.id, mergedSpec, report.productStatus, null);

  appendQualityEvent({
    canonicalProductId: keep.id,
    eventType: "merged",
    beforeJson: { spec: beforeSpec },
    afterJson: { spec: mergedSpec, productStatus: report.productStatus },
    reason: `并入 ${duplicate.id}（来源 ${reattached.sources} 条、证据 ${reattached.evidence} 条，补缺 ${filled} 字段）：${input.reason}`,
    actor: `reviewer:${reviewer}`,
  });
  appendQualityEvent({
    canonicalProductId: duplicate.id,
    eventType: "deprecated",
    beforeJson: { mergedInto: null },
    afterJson: { mergedInto: keep.id },
    reason: `已并入 ${keep.id}：${input.reason}`,
    actor: `reviewer:${reviewer}`,
  });
  return computeProductFieldStatuses(keep.id);
}

// ---- 审核上下文与队列 ----

export function getReviewContext(canonicalProductId: string): {
  product: NonNullable<ReturnType<typeof getCatalogSnapshot>>;
  sources: ProductSource[];
  evidence: ProductFieldEvidence[];
  report: ProductFieldStatusReport | null;
} {
  const snapshot = getCatalogSnapshot(canonicalProductId);
  if (!snapshot) throw new CatalogReviewError(`产品不存在：${canonicalProductId}`);
  const report = snapshot.mergedInto ? null : computeProductFieldStatuses(canonicalProductId);
  return {
    product: snapshot,
    sources: listProductSources(canonicalProductId),
    evidence: listFieldEvidence(canonicalProductId),
    report,
  };
}

export function createCatalogQueueItem(
  input: Parameters<typeof createQueueItem>[0],
): ReturnType<typeof createQueueItem> {
  if (!input.reason.trim()) throw new CatalogReviewError("队列项必须说明创建原因");
  return createQueueItem(input);
}

export function listCatalogQueue(options?: Parameters<typeof listQueueItems>[0]): ReturnType<typeof listQueueItems> {
  return listQueueItems(options);
}

export function updateCatalogQueueItem(
  id: string,
  patch: Parameters<typeof updateQueueItem>[1] & { reviewer: string },
): ReturnType<typeof updateQueueItem> {
  const reviewer = requireReviewer(patch.reviewer);
  const rest: Parameters<typeof updateQueueItem>[1] = {
    status: patch.status,
    assignedTo: patch.assignedTo,
    resolutionNote: patch.resolutionNote,
  };
  const item = updateQueueItem(id, rest);
  if (rest.status) {
    // 事件挂在真实产品上（new_product 队列项尚无产品，队列行自身就是记录）
    const owner = item.candidateCanonicalIds[0] ?? null;
    const productExists = owner ? getCatalogSnapshot(owner) !== null : false;
    if (owner && productExists) {
      appendQualityEvent({
        canonicalProductId: owner,
        eventType: "reviewed",
        beforeJson: null,
        afterJson: { queueItemId: item.id, queueStatus: item.status, assignedTo: item.assignedTo },
        reason: `审核队列项 → ${item.status}`,
        actor: `reviewer:${reviewer}`,
      });
    }
  }
  return item;
}
