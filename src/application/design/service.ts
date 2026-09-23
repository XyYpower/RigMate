import { randomUUID } from "node:crypto";
import { designRequestInputSchema, type AgentEvent, type AgentRun, type DesignRequest, type DesignResult } from "@/contracts/design";
import { CATALOG } from "@/domain/catalog/seed";
import { mergedCatalogEntries } from "@/infra/catalog-import/load";
import { parseDesignIntent, intentNeedsInput } from "@/domain/design/intent";
import { generateDesignProposal } from "@/domain/design/proposal";
import {
  findDesignRequest,
  findLatestProposal,
  findProposal,
  findRunForRequest,
  markProposalAccepted,
  appendAgentEvent,
  saveAgentRun,
  saveDesignProposal,
  saveDesignRequest,
  updateDesignRequestStatus,
} from "@/infra/db/repositories/design-repository";
import { createBuild, addBuildItem, checkBuild, getBuild } from "@/application/builds/service";

function now(): string {
  return new Date().toISOString();
}

function event(runId: string, type: AgentEvent["type"], status: AgentEvent["status"], message: string): AgentEvent {
  return { id: randomUUID(), runId, type, status, message, createdAt: now() };
}

function createRun(requestId: string): { run: AgentRun; events: AgentEvent[] } {
  const runId = randomUUID();
  const events: AgentEvent[] = [];
  return {
    run: {
      id: runId,
      requestId,
      proposalId: null,
      status: "running",
      createdAt: now(),
      completedAt: null,
      events,
    },
    events,
  };
}

export function createDesignRequest(input: unknown): DesignResult {
  const data = designRequestInputSchema.parse(input);
  const requestId = randomUUID();
  const timestamp = now();
  const intent = parseDesignIntent(data);
  const request: DesignRequest = {
    id: requestId,
    rawInput: data.rawInput,
    intent,
    status: intentNeedsInput(intent) ? "needs_input" as const : "generating" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  saveDesignRequest(request);

  const { run, events } = createRun(requestId);
  events.push(event(run.id, "understanding", "started", "正在理解预算、用途和外观偏好。"));
  events.push(event(run.id, "understanding", "completed", "已整理目标和主要取舍。"));
  if (intentNeedsInput(intent)) {
    events.push(event(run.id, "question", "waiting", "还缺少预算或用途，补充一句目标后我才能开始搭配。"));
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    return { request, proposal: null, run };
  }
  events.push(event(run.id, "retrieving", "started", "正在检索目录和已核验规格。"));
  const entries = mergedCatalogEntries(CATALOG);
  events.push(event(run.id, "retrieving", "completed", `本地目录就绪（${entries.length.toLocaleString("zh-CN")} 条），按预算档位挑选候选。`));
  events.push(event(run.id, "composing", "started", "正在组合一套兼顾用途、预算和外观的方案。"));
  const generated = generateDesignProposal({ requestId, intent, entries });
  events.push(event(run.id, "composing", "completed", `已生成 ${generated.proposal.items.length} 个核心配件候选。`));
  events.push(event(run.id, "validating", "started", "正在自动检查主要硬件之间的兼容关系。"));
  events.push(event(run.id, "validating", "completed", generated.proposal.compatibility.message));
  events.push(event(run.id, "completed", "completed", "方案已准备好，可以接受、调整或进入高级 DIY。"));

  saveDesignProposal(generated.proposal);
  run.proposalId = generated.proposal.id;
  run.status = "completed";
  run.completedAt = now();
  saveAgentRun(run);
  request.status = "ready_to_review";
  request.updatedAt = now();
  updateDesignRequestStatus(request.id, request.status);
  return { request, proposal: generated.proposal, run };
}

export function getDesignResult(requestId: string): DesignResult | null {
  const request = findDesignRequest(requestId);
  if (!request) return null;
  const proposal = findLatestProposal(requestId) ?? null;
  const run = findRunForRequest(requestId);
  if (!run) return null;
  return { request, proposal, run };
}

export function acceptDesignProposal(proposalId: string, allowConflicts = false): { buildId: string; build: ReturnType<typeof getBuild> } {
  const proposal = findProposal(proposalId);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
  if (proposal.acceptedBuildId) {
    const existing = getBuild(proposal.acceptedBuildId);
    if (existing) return { buildId: existing.id, build: existing };
  }
  if (proposal.compatibility.status === "conflict" && !allowConflicts) throw new Error("PROPOSAL_HAS_CONFLICT");
  const request = findDesignRequest(proposal.requestId);
  if (!request) throw new Error("DESIGN_REQUEST_NOT_FOUND");
  const build = createBuild({
    name: proposal.title,
    useCase: proposal.fitNotes.join("；").slice(0, 120),
    budgetCents: proposal.budgetCents,
  });
  for (const item of proposal.items) {
    addBuildItem(build.id, {
      category: item.category,
      label: item.label,
      spec: item.spec,
      source: item.catalogId ? `catalog:${item.catalogId}` : undefined,
    });
  }
  const checked = checkBuild(build.id);
  markProposalAccepted(proposal.id, checked.build.id);
  updateDesignRequestStatus(request.id, "accepted");
  const run = findRunForRequest(request.id);
  if (run) {
    appendAgentEvent(event(run.id, "accepted", "completed", "你已接受这套方案，正式项目和自动检查结果已保存。"));
  }
  return { buildId: checked.build.id, build: checked.build };
}
