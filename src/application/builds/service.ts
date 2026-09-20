import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  buildItemInputSchema,
  createBuildInputSchema,
  type Build,
  type BuildItem,
  type CreateBuildInput,
  type Finding,
} from "@/domain/build/types";
import { itemsFingerprint } from "@/domain/build/fingerprint";
import { computeBudgetSummary } from "@/domain/build/budget";
import { runBuildChecks, sortFindings } from "@/domain/rules/engine";
import {
  deleteBuildRow,
  findBuildById,
  findAllBuilds,
  findLatestCheckRun,
  saveBuild,
  saveBuildItem,
  saveCheckRun,
  setBuildStatus,
} from "@/infra/db/repositories/build-repository";

function now(): string {
  return new Date().toISOString();
}

function withBudgetSummary(build: Build): Build {
  return { ...build, budgetSummary: computeBudgetSummary(build.budgetCents, build.items) };
}

export function createBuild(input: CreateBuildInput): Build {
  const data = createBuildInputSchema.parse(input);
  const timestamp = now();
  const build: Build = {
    id: randomUUID(),
    name: data.name,
    useCase: data.useCase ?? null,
    budgetCents: data.budgetCents ?? null,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    items: [],
  };
  saveBuild(build);
  return withBudgetSummary(build);
}

export function listBuilds(): Build[] {
  return findAllBuilds().map(withBudgetSummary);
}

export function getBuild(id: string): Build | undefined {
  const build = findBuildById(id);
  return build ? withBudgetSummary(build) : undefined;
}

export function addBuildItem(buildId: string, input: unknown): Build {
  const build = findBuildById(buildId);
  if (!build) throw new Error("BUILD_NOT_FOUND");
  const data = buildItemInputSchema.parse(input);
  const item: BuildItem = {
    ...data,
    id: randomUUID(),
    buildId,
    createdAt: now(),
  };
  saveBuildItem(item);
  setBuildStatus(buildId, "needs_confirmation", now());
  const updated = findBuildById(buildId);
  if (!updated) throw new Error("BUILD_NOT_FOUND");
  return withBudgetSummary(updated);
}

export function checkBuild(buildId: string): { build: Build; findings: Finding[] } {
  const build = findBuildById(buildId);
  if (!build) throw new Error("BUILD_NOT_FOUND");
  const findings = runBuildChecks(build.items);
  saveCheckRun({ buildId, itemsSnapshot: itemsFingerprint(build.items), findings });
  setBuildStatus(buildId, "reviewed", now());
  const updated = findBuildById(buildId);
  if (!updated) throw new Error("BUILD_NOT_FOUND");
  return { build: withBudgetSummary(updated), findings };
}

export type LatestCheck = { createdAt: string; stale: boolean; findings: Finding[] };

export function getLatestCheck(buildId: string): LatestCheck | null {
  const build = findBuildById(buildId);
  if (!build) throw new Error("BUILD_NOT_FOUND");
  const run = findLatestCheckRun(buildId);
  if (!run) return null;
  return {
    createdAt: run.createdAt,
    stale: run.itemsSnapshot !== itemsFingerprint(build.items),
    findings: sortFindings(run.findings),
  };
}

export function deleteBuild(id: string): void {
  deleteBuildRow(id);
}

export const buildIdSchema = z.string().uuid();
