import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import {
  buildItemInputSchema,
  buildStatusSchema,
  type Build,
  type BuildItem,
  type BuildStatus,
  type Finding,
} from "@/domain/build/types";
import { buildItems, builds, checkRuns, ensureDatabase, findings } from "../client";

function mapBuildRow(row: typeof builds.$inferSelect, items: BuildItem[]): Build {
  return {
    id: row.id,
    name: row.name,
    useCase: row.useCase,
    budgetCents: row.budgetCents,
    status: buildStatusSchema.parse(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items,
  };
}

function mapItemRow(row: typeof buildItems.$inferSelect): BuildItem {
  const input = buildItemInputSchema.parse({
    category: row.category,
    label: row.label,
    source: row.source ?? undefined,
    priceCents: row.priceCents ?? undefined,
    spec: row.spec && row.spec.trim() !== "" ? JSON.parse(row.spec) : {},
  });
  return { ...input, id: row.id, buildId: row.buildId, createdAt: row.createdAt };
}

export function saveBuild(build: Build): void {
  ensureDatabase()
    .insert(builds)
    .values({
      id: build.id,
      name: build.name,
      useCase: build.useCase,
      budgetCents: build.budgetCents,
      status: build.status,
      createdAt: build.createdAt,
      updatedAt: build.updatedAt,
    })
    .run();
}

export function findAllBuilds(): Build[] {
  const db = ensureDatabase();
  const buildRows = db.select().from(builds).all();
  const itemRows = db.select().from(buildItems).all();
  return buildRows.map((row) =>
    mapBuildRow(
      row,
      itemRows.filter((item) => item.buildId === row.id).map(mapItemRow),
    ),
  );
}

export function findBuildById(id: string): Build | undefined {
  const db = ensureDatabase();
  const row = db.select().from(builds).where(eq(builds.id, id)).get();
  if (!row) return undefined;
  const itemRows = db.select().from(buildItems).where(eq(buildItems.buildId, id)).all();
  return mapBuildRow(row, itemRows.map(mapItemRow));
}

export function saveBuildItem(item: BuildItem): void {
  ensureDatabase()
    .insert(buildItems)
    .values({
      id: item.id,
      buildId: item.buildId,
      category: item.category,
      label: item.label,
      spec: JSON.stringify(item.spec),
      priceCents: item.priceCents,
      source: item.source,
      createdAt: item.createdAt,
    })
    .run();
}

export function setBuildStatus(id: string, status: BuildStatus, updatedAt: string): void {
  ensureDatabase()
    .update(builds)
    .set({ status, updatedAt })
    .where(eq(builds.id, id))
    .run();
}

export function saveCheckRun(input: {
  buildId: string;
  itemsSnapshot: string;
  findings: Finding[];
}): string {
  const db = ensureDatabase();
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  db.insert(checkRuns)
    .values({
      id: runId,
      buildId: input.buildId,
      createdAt,
      status: "completed",
      itemsSnapshot: input.itemsSnapshot,
    })
    .run();
  for (const finding of input.findings) {
    db.insert(findings)
      .values({
        id: randomUUID(),
        checkRunId: runId,
        ruleId: finding.ruleId,
        status: finding.status,
        payload: JSON.stringify(finding),
      })
      .run();
  }
  return runId;
}

export function findLatestCheckRun(
  buildId: string,
): { createdAt: string; itemsSnapshot: string; findings: Finding[] } | null {
  const db = ensureDatabase();
  const run = db
    .select()
    .from(checkRuns)
    .where(eq(checkRuns.buildId, buildId))
    .orderBy(desc(checkRuns.createdAt))
    .limit(1)
    .get();
  if (!run) return null;
  const runFindings = db
    .select()
    .from(findings)
    .where(eq(findings.checkRunId, run.id))
    .all()
    .map((row) => JSON.parse(row.payload) as Finding);
  return { createdAt: run.createdAt, itemsSnapshot: run.itemsSnapshot, findings: runFindings };
}

export function deleteBuildRow(id: string): void {
  const db = ensureDatabase();
  db.run(
    sql`DELETE FROM findings WHERE check_run_id IN (SELECT id FROM check_runs WHERE build_id = ${id})`,
  );
  db.run(sql`DELETE FROM check_runs WHERE build_id = ${id}`);
  db.run(sql`DELETE FROM build_items WHERE build_id = ${id}`);
  db.run(sql`DELETE FROM builds WHERE id = ${id}`);
}
