import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  dataQualityEventSchema,
  pendingCatalogItemSchema,
  type DataQualityEvent,
  type PendingCatalogItem,
  type QualityEventType,
  type ReviewQueuePriority,
  type ReviewQueueStatus,
  type ReviewQueueType,
} from "@/contracts/catalog";
import { buildItemCategorySchema } from "@/domain/build/types";
import { canonicalProducts, dataQualityEvents, ensureDatabase, pendingCatalogQueue } from "../client";

/**
 * 数据质量事件与待审核队列仓储（PROVENANCE §4、PLAYBOOK §5/§6）。
 *
 * 纪律：
 * - 质量事件**只增不改**：导入/审核/修正/冲突/合并都留痕，before/after 是 JSON 快照；
 * - 队列状态机：open → processing → resolved/dismissed（open 可直达 resolved，快速处理）；
 *   resolved/dismissed 为终态，不允许"复活"——纠错请开新队列项；
 * - 队列项必须指向已存在的产品（new_product 类型除外，它就是为"目录里还没有"而生）。
 */

const QUEUE_STATUS_TRANSITIONS: Record<ReviewQueueStatus, ReviewQueueStatus[]> = {
  open: ["processing", "resolved", "dismissed"],
  processing: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};

export type AppendQualityEventInput = Omit<DataQualityEvent, "id" | "createdAt"> & { createdAt?: string };

/** 追加质量事件；产品必须已存在，before/after 为可序列化 JSON 快照 */
export function appendQualityEvent(input: AppendQualityEventInput): DataQualityEvent {
  const db = ensureDatabase();
  const product = db
    .select({ id: canonicalProducts.id })
    .from(canonicalProducts)
    .where(eq(canonicalProducts.id, input.canonicalProductId))
    .get();
  if (!product) throw new Error(`产品不存在，无法记录质量事件：${input.canonicalProductId}`);

  const record = dataQualityEventSchema.parse({
    ...input,
    id: `qe-${randomUUID()}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  db.insert(dataQualityEvents)
    .values({
      id: record.id,
      canonicalProductId: record.canonicalProductId,
      eventType: record.eventType,
      beforeJson: record.beforeJson === null ? null : JSON.stringify(record.beforeJson),
      afterJson: record.afterJson === null ? null : JSON.stringify(record.afterJson),
      reason: record.reason,
      actor: record.actor,
      createdAt: record.createdAt,
    })
    .run();
  return record;
}

export function listQualityEvents(canonicalProductId: string, limit = 50): DataQualityEvent[] {
  return ensureDatabase()
    .select()
    .from(dataQualityEvents)
    .where(eq(dataQualityEvents.canonicalProductId, canonicalProductId))
    .orderBy(desc(dataQualityEvents.createdAt))
    .limit(limit)
    .all()
    .map((row) =>
      dataQualityEventSchema.parse({
        id: row.id,
        canonicalProductId: row.canonicalProductId,
        eventType: row.eventType as QualityEventType,
        beforeJson: row.beforeJson === null ? null : (JSON.parse(row.beforeJson) as Record<string, unknown>),
        afterJson: row.afterJson === null ? null : (JSON.parse(row.afterJson) as Record<string, unknown>),
        reason: row.reason,
        actor: row.actor,
        createdAt: row.createdAt,
      }),
    );
}

export type CreateQueueItemInput = Omit<
  PendingCatalogItem,
  "id" | "createdAt" | "updatedAt" | "resolvedAt" | "status" | "assignedTo" | "resolutionNote"
> & {
  status?: ReviewQueueStatus;
  assignedTo?: string | null;
  resolutionNote?: string | null;
};

/** 创建待审核队列项（状态默认 open） */
export function createQueueItem(input: CreateQueueItemInput): PendingCatalogItem {
  const db = ensureDatabase();
  if (input.queueType !== "new_product") {
    const product = db
      .select({ id: canonicalProducts.id })
      .from(canonicalProducts)
      .where(eq(canonicalProducts.id, input.candidateCanonicalIds[0] ?? ""))
      .get();
    if (!product) throw new Error(`队列项指向的产品不存在：${input.candidateCanonicalIds[0] ?? "(空)"}`);
  }
  const timestamp = new Date().toISOString();
  const record = pendingCatalogItemSchema.parse({
    ...input,
    assignedTo: input.assignedTo ?? null,
    resolutionNote: input.resolutionNote ?? null,
    id: `pq-${randomUUID()}`,
    status: input.status ?? "open",
    createdAt: timestamp,
    updatedAt: timestamp,
    resolvedAt: null,
  });
  db.insert(pendingCatalogQueue)
    .values({
      id: record.id,
      queueType: record.queueType,
      category: record.category,
      userInput: record.userInput,
      candidateIds: JSON.stringify(record.candidateCanonicalIds),
      missingFields: JSON.stringify(record.missingFields),
      priority: record.priority,
      reason: record.reason,
      status: record.status,
      assignedTo: record.assignedTo,
      resolutionNote: record.resolutionNote,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      resolvedAt: record.resolvedAt,
    })
    .run();
  return record;
}

const PRIORITY_ORDER: Record<ReviewQueuePriority, number> = { high: 0, normal: 1, low: 2 };

export function listQueueItems(
  options: { status?: ReviewQueueStatus; queueType?: ReviewQueueType; limit?: number } = {},
): PendingCatalogItem[] {
  const rows = ensureDatabase()
    .select()
    .from(pendingCatalogQueue)
    .where(
      options.status ? eq(pendingCatalogQueue.status, options.status) : undefined,
    )
    .orderBy(desc(pendingCatalogQueue.createdAt))
    .limit(options.limit ?? 100)
    .all()
    .map((row) =>
      pendingCatalogItemSchema.parse({
        id: row.id,
        queueType: row.queueType as ReviewQueueType,
        category: buildItemCategorySchema.parse(row.category),
        userInput: row.userInput,
        candidateCanonicalIds: JSON.parse(row.candidateIds) as string[],
        missingFields: JSON.parse(row.missingFields) as string[],
        priority: row.priority as ReviewQueuePriority,
        reason: row.reason,
        status: row.status as ReviewQueueStatus,
        assignedTo: row.assignedTo,
        resolutionNote: row.resolutionNote,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        resolvedAt: row.resolvedAt,
      }),
    );
  const filtered = options.queueType
    ? rows.filter((item) => item.queueType === options.queueType)
    : rows;
  return filtered.sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.createdAt < b.createdAt ? 1 : -1),
  );
}

export type QueueItemPatch = {
  status?: ReviewQueueStatus;
  assignedTo?: string | null;
  resolutionNote?: string | null;
};

/** 队列状态流转与认领；非法流转（如 resolved → open）抛错 */
export function updateQueueItem(id: string, patch: QueueItemPatch): PendingCatalogItem {
  const db = ensureDatabase();
  const row = db.select().from(pendingCatalogQueue).where(eq(pendingCatalogQueue.id, id)).get();
  if (!row) throw new Error(`队列项不存在：${id}`);
  const current = row.status as ReviewQueueStatus;
  if (patch.status && !QUEUE_STATUS_TRANSITIONS[current].includes(patch.status)) {
    throw new Error(`非法的队列状态流转：${current} → ${patch.status}（终态不可复活，纠错请开新队列项）`);
  }
  const timestamp = new Date().toISOString();
  db.update(pendingCatalogQueue)
    .set({
      status: patch.status ?? current,
      assignedTo: patch.assignedTo ?? row.assignedTo,
      resolutionNote: patch.resolutionNote ?? row.resolutionNote,
      updatedAt: timestamp,
      resolvedAt: patch.status === "resolved" || patch.status === "dismissed" ? timestamp : row.resolvedAt,
    })
    .where(eq(pendingCatalogQueue.id, id))
    .run();
  const updated = db.select().from(pendingCatalogQueue).where(eq(pendingCatalogQueue.id, id)).get();
  return {
    id: updated!.id,
    queueType: updated!.queueType as ReviewQueueType,
    category: buildItemCategorySchema.parse(updated!.category),
    userInput: updated!.userInput,
    candidateCanonicalIds: JSON.parse(updated!.candidateIds) as string[],
    missingFields: JSON.parse(updated!.missingFields) as string[],
    priority: updated!.priority as ReviewQueuePriority,
    reason: updated!.reason,
    status: updated!.status as ReviewQueueStatus,
    assignedTo: updated!.assignedTo,
    resolutionNote: updated!.resolutionNote,
    createdAt: updated!.createdAt,
    updatedAt: updated!.updatedAt,
    resolvedAt: updated!.resolvedAt,
  };
}
