import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  agentEvents,
  agentRuns,
  designProposals,
  designRequests,
  ensureDatabase,
  proposalItems,
} from "../client";
import {
  agentEventSchema,
  agentRunStatusSchema,
  designProposalSchema,
  designRequestStatusSchema,
  type AgentEvent,
  type AgentRun,
  type DesignProposal,
  type DesignRequest,
  type StructuredIntent,
} from "@/contracts/design";

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function mapRequest(row: typeof designRequests.$inferSelect): DesignRequest {
  return {
    id: row.id,
    rawInput: row.rawInput,
    intent: parseJson<StructuredIntent>(row.intent),
    status: designRequestStatusSchema.parse(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProposal(row: typeof designProposals.$inferSelect, rows: (typeof proposalItems.$inferSelect)[]): DesignProposal {
  return designProposalSchema.parse({
    id: row.id,
    requestId: row.requestId,
    version: row.version,
    status: row.status,
    title: row.title,
    summary: row.summary,
    budgetCents: row.budgetCents,
    estimatedLowCents: row.estimatedLowCents,
    estimatedHighCents: row.estimatedHighCents,
    acceptedBuildId: row.acceptedBuildId,
    items: rows.map((item) => ({
      category: item.category,
      label: item.label,
      catalogId: item.catalogId ?? undefined,
      spec: parseJson<Record<string, unknown>>(item.spec),
      sourceLevel: item.sourceLevel,
      priceEstimateLowCents: item.priceEstimateLowCents,
      priceEstimateHighCents: item.priceEstimateHighCents,
      priceBasis: item.priceBasis,
      rationale: item.rationale,
      confirmationRequired: item.confirmationRequired,
      confirmationReason: item.confirmationReason ?? undefined,
    })),
    fitNotes: parseJson<string[]>(row.fitNotes),
    tradeoffs: parseJson<string[]>(row.tradeoffs),
    unknowns: parseJson<string[]>(row.unknowns),
    compatibility: parseJson(row.compatibility),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapEvent(row: typeof agentEvents.$inferSelect): AgentEvent {
  return agentEventSchema.parse({
    id: row.id,
    runId: row.runId,
    type: row.type,
    status: row.status,
    message: row.message,
    createdAt: row.createdAt,
  });
}

export function saveDesignRequest(request: DesignRequest): void {
  ensureDatabase().insert(designRequests).values({
    id: request.id,
    rawInput: request.rawInput,
    intent: JSON.stringify(request.intent),
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }).run();
}

export function saveDesignProposal(proposal: DesignProposal): void {
  const db = ensureDatabase();
  db.insert(designProposals).values({
    id: proposal.id,
    requestId: proposal.requestId,
    version: proposal.version,
    status: proposal.status,
    title: proposal.title,
    summary: proposal.summary,
    budgetCents: proposal.budgetCents,
    estimatedLowCents: proposal.estimatedLowCents,
    estimatedHighCents: proposal.estimatedHighCents,
    acceptedBuildId: proposal.acceptedBuildId ?? null,
    fitNotes: JSON.stringify(proposal.fitNotes),
    tradeoffs: JSON.stringify(proposal.tradeoffs),
    unknowns: JSON.stringify(proposal.unknowns),
    compatibility: JSON.stringify(proposal.compatibility),
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  }).run();
  for (const item of proposal.items) {
    db.insert(proposalItems).values({
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      category: item.category,
      label: item.label,
      catalogId: item.catalogId ?? null,
      spec: JSON.stringify(item.spec),
      sourceLevel: item.sourceLevel,
      priceEstimateLowCents: item.priceEstimateLowCents,
      priceEstimateHighCents: item.priceEstimateHighCents,
      priceBasis: item.priceBasis,
      rationale: item.rationale,
      confirmationRequired: item.confirmationRequired,
      confirmationReason: item.confirmationReason ?? null,
    }).run();
  }
}

export function saveAgentRun(run: AgentRun): void {
  const db = ensureDatabase();
  db.insert(agentRuns).values({
    id: run.id,
    requestId: run.requestId,
    proposalId: run.proposalId,
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  }).run();
  for (const event of run.events) {
    db.insert(agentEvents).values({
      id: event.id,
      runId: event.runId,
      type: event.type,
      status: event.status,
      message: event.message,
      createdAt: event.createdAt,
    }).run();
  }
}

export function findDesignRequest(id: string): DesignRequest | undefined {
  const row = ensureDatabase().select().from(designRequests).where(eq(designRequests.id, id)).get();
  return row ? mapRequest(row) : undefined;
}

export function findLatestProposal(requestId: string): DesignProposal | undefined {
  const db = ensureDatabase();
  const row = db.select().from(designProposals).where(eq(designProposals.requestId, requestId)).orderBy(desc(designProposals.version)).limit(1).get();
  if (!row) return undefined;
  const rows = db.select().from(proposalItems).where(eq(proposalItems.proposalId, row.id)).all();
  return mapProposal(row, rows);
}

export function findProposal(id: string): DesignProposal | undefined {
  const db = ensureDatabase();
  const row = db.select().from(designProposals).where(eq(designProposals.id, id)).get();
  if (!row) return undefined;
  const rows = db.select().from(proposalItems).where(eq(proposalItems.proposalId, id)).all();
  return mapProposal(row, rows);
}

export function findRunForRequest(requestId: string): AgentRun | undefined {
  const db = ensureDatabase();
  const run = db.select().from(agentRuns).where(eq(agentRuns.requestId, requestId)).orderBy(desc(agentRuns.createdAt)).limit(1).get();
  if (!run) return undefined;
  const events = db.select().from(agentEvents).where(eq(agentEvents.runId, run.id)).orderBy(agentEvents.createdAt).all().map(mapEvent);
  return {
    id: run.id,
    requestId: run.requestId,
    proposalId: run.proposalId,
    status: agentRunStatusSchema.parse(run.status),
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    events,
  };
}

export function appendAgentEvent(event: AgentEvent): void {
  ensureDatabase().insert(agentEvents).values({
    id: event.id,
    runId: event.runId,
    type: event.type,
    status: event.status,
    message: event.message,
    createdAt: event.createdAt,
  }).run();
}

export function updateDesignRequestStatus(id: string, status: DesignRequest["status"]): void {
  ensureDatabase().update(designRequests).set({ status, updatedAt: new Date().toISOString() }).where(eq(designRequests.id, id)).run();
}

/** 修订后的意图回写：intent 与状态一起更新（M31） */
export function updateDesignRequestIntent(
  id: string,
  intent: StructuredIntent,
  status: DesignRequest["status"],
): void {
  ensureDatabase()
    .update(designRequests)
    .set({ intent: JSON.stringify(intent), status, updatedAt: new Date().toISOString() })
    .where(eq(designRequests.id, id))
    .run();
}

/** 下一版方案号：该请求下最大 version + 1（无方案时为 1） */
export function nextProposalVersion(requestId: string): number {
  const row = ensureDatabase()
    .select({ maxVersion: sql<number>`max(version)` })
    .from(designProposals)
    .where(eq(designProposals.requestId, requestId))
    .get();
  return (row?.maxVersion ?? 0) + 1;
}

/** 新版本落库后，把同请求下其他未接受的方案标记为 replaced（已接受的保留不动） */
export function markProposalsReplaced(requestId: string, exceptProposalId: string): void {
  ensureDatabase()
    .update(designProposals)
    .set({ status: "replaced", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(designProposals.requestId, requestId),
        ne(designProposals.id, exceptProposalId),
        ne(designProposals.status, "accepted"),
      ),
    )
    .run();
}

export function markProposalAccepted(proposalId: string, buildId: string): void {
  ensureDatabase().update(designProposals).set({ status: "accepted", acceptedBuildId: buildId, updatedAt: new Date().toISOString() }).where(eq(designProposals.id, proposalId)).run();
}
