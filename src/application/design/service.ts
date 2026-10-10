import { randomUUID } from "node:crypto";
import { designRequestInputSchema, designRevisionInputSchema, type AgentEvent, type AgentRun, type DesignRequest, type DesignResult, type StructuredIntent } from "@/contracts/design";
import { loadSourcedCatalog } from "@/infra/catalog-import/load";
import { resolveLlmConfigFromEnv } from "@/infra/llm/client";
import { parseIntentWithLlm, proposeSwapWithLlm, reviseIntentWithLlm, selectCatalogCandidatesWithLlm } from "./intent-llm";
import { loadPriceContext } from "./price-context";
import { parseDesignIntent, intentNeedsInput } from "@/domain/design/intent";
import { reviseIntentWithRules } from "@/domain/design/revision";
import { diffProposals } from "@/domain/design/diff";
import { generateDesignProposal, type CandidateQualityContext } from "@/domain/design/proposal";
import { buildCandidatePool } from "@/domain/catalog/ranking";
import { computeEvidenceBackedFieldStatuses } from "@/application/catalog-review/service";
import {
  findDesignRequest,
  findLatestProposal,
  findProposals,
  findProposal,
  findRunForRequest,
  markProposalAccepted,
  markProposalsReplaced,
  nextProposalVersion,
  appendAgentEvent,
  saveAgentRun,
  saveDesignProposal,
  saveDesignRequest,
  updateDesignRequestIntent,
  updateDesignRequestStatus,
  findPreviousProposal,
} from "@/infra/db/repositories/design-repository";
import { createBuild, addBuildItem, checkBuild, getBuild } from "@/application/builds/service";
import { createAgentAttempt, orchestrateDesignGeneration } from "@/application/agent/orchestrator";
import { CATALOG_SELECTION_PROMPT_VERSION } from "./intent-llm";
import type { VerifiedPriceFact } from "@/domain/catalog/ranking";
import type { BuildItemCategory } from "@/domain/build/types";

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

const CANDIDATE_CATEGORIES: BuildItemCategory[] = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"];

/** 内核恢复管线（Task A/B/C）：目录 → 质量门 + 排序 → 价格上下文 → 候选池 + 字段质量层 */
function retrieveCandidateContext(intent: StructuredIntent): {
  catalogSize: number;
  entries: ReturnType<typeof loadSourcedCatalog>["entries"];
  priceByCanonicalId: Map<string, VerifiedPriceFact>;
  pool: ReturnType<typeof buildCandidatePool>["pool"];
  missingCategories: BuildItemCategory[];
  qualityByCanonicalId: Map<string, CandidateQualityContext>;
} {
  const { entries, dbBacked } = loadSourcedCatalog();
  const priceByCanonicalId = loadPriceContext({ region: intent.region });
  const { pool, missingCategories } = buildCandidatePool(entries, intent, CANDIDATE_CATEGORIES, priceByCanonicalId);
  // 字段质量层只在有证据链的库目录上解析（JSON 回退/fixture 无证据 → 空映射 = 无质量层）
  const qualityByCanonicalId = new Map<string, CandidateQualityContext>();
  if (dbBacked) {
    for (const candidate of pool) {
      try {
        qualityByCanonicalId.set(candidate.canonicalId, computeEvidenceBackedFieldStatuses(candidate.canonicalId));
      } catch {
        // 单个候选证据链异常不阻断方案生成：按无质量层处理，后续规则照常运行
      }
    }
  }
  return { catalogSize: entries.length, entries, priceByCanonicalId, pool, missingCategories, qualityByCanonicalId };
}

/** 生成或诚实追问：候选池为空（或生成器判定不足）时不硬凑方案 */
function composeOrAsk(input: {
  requestId: string;
  intent: StructuredIntent;
  context: ReturnType<typeof retrieveCandidateContext>;
  version?: number;
  preferredIds?: Partial<Record<BuildItemCategory, string>>;
  rationaleByCategory?: Partial<Record<BuildItemCategory, string>>;
  run: AgentRun;
  events: AgentEvent[];
}): DesignResult["proposal"] {
  const context = input.context;
  input.events.push(
    event(
      input.run.id,
      "retrieving",
      "completed",
      `本地目录就绪（${context.catalogSize.toLocaleString("zh-CN")} 条）；质量门（verified/supported）后有效候选 ${context.pool.length} 条${
        context.missingCategories.length > 0 ? `，缺类别：${context.missingCategories.join("、")}` : ""
      }。`,
    ),
  );
  if (context.pool.length === 0) {
    input.events.push(
      event(
        input.run.id,
        "question",
        "waiting",
        "目录中暂时没有通过质量门的候选（verified/supported），不能凑出可信方案。请先在目录审核流程中补充证据，再回来生成方案。",
      ),
    );
    return null;
  }
  input.events.push(event(input.run.id, "composing", "started", "正在组合一套兼顾用途、预算和外观的方案。"));
  const generated = generateDesignProposal({
    requestId: input.requestId,
    intent: input.intent,
    candidates: context.pool,
    qualityContextByCanonicalId: context.qualityByCanonicalId,
    version: input.version,
    preferredIds: input.preferredIds,
    rationaleByCategory: input.rationaleByCategory,
  });
  if (generated.status === "insufficient") {
    input.events.push(
      event(
        input.run.id,
        "question",
        "waiting",
        `以下类别没有通过质量门的目录候选：${generated.missingCategories.join("、")}。方案不会用资料不足的型号凑数；可在目录中补充证据后重试。`,
      ),
    );
    return null;
  }
  input.events.push(event(input.run.id, "composing", "completed", `已生成 ${generated.proposal.items.length} 个核心配件候选。`));
  input.events.push(event(input.run.id, "validating", "started", "正在自动检查主要硬件之间的兼容关系。"));
  input.events.push(event(input.run.id, "validating", "completed", generated.proposal.compatibility.message));
  input.events.push(event(input.run.id, "validating", "completed", "候选、价格与兼容事实由本地目录、价格证据和规则引擎核验，模型不参与事实判断。"));
  input.events.push(event(input.run.id, "completed", "completed", "方案已准备好，可以接受、调整或进入高级 DIY。"));
  return generated.proposal;
}

export async function createDesignRequest(input: unknown): Promise<DesignResult> {
  const data = designRequestInputSchema.parse(input);
  const requestId = randomUUID();
  const timestamp = now();
  // 意图理解：配了 LLM 用模型（失败自动降级），没配直接走本地规则——两条路都如实告知用户
  const llmConfig = resolveLlmConfigFromEnv();
  let intent;
  let intentNote = "本地规则理解目标（未配置大模型）。";
  if (llmConfig) {
    const llmResult = await parseIntentWithLlm({
      rawInput: data.rawInput,
      explicitBudgetYuan: data.budgetCents !== null && data.budgetCents !== undefined ? data.budgetCents / 100 : null,
      config: llmConfig,
    });
    if (llmResult.ok) {
      intent = llmResult.data;
      intentNote = `大模型（${llmConfig.model}）已解析预算、用途与偏好。`;
    } else {
      intent = parseDesignIntent(data);
      intentNote = `大模型不可用（${llmResult.reason}），已用本地规则理解目标。`;
    }
  } else {
    intent = parseDesignIntent(data);
  }
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
  events.push(event(run.id, "understanding", "completed", intentNote));
  if (intentNeedsInput(intent)) {
    events.push(event(run.id, "question", "waiting", "还缺少预算或用途，补充一句目标后我才能开始搭配。"));
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    return { request, proposal: null, run, changes: [], versions: [] };
  }
  events.push(event(run.id, "retrieving", "started", "正在检索目录和已核验规格。"));
  // Phase 5：生成流程接入 Agent Runtime（可审计状态机 + 守卫回退 + Claim Ledger）；
  // 本 service 是兼容 adapter——UX 文案与 DesignResult 结构保持不变。
  const attempt = createAgentAttempt({
    model: llmConfig?.model ?? "rule-engine",
    promptVersion: CATALOG_SELECTION_PROMPT_VERSION,
    deadlineMs: 20_000,
  });
  let modelNote: string | null = null;
  const outcome = await orchestrateDesignGeneration({
    requestId,
    intent,
    attempt,
    categories: CANDIDATE_CATEGORIES,
    retrieve: () => {
      const context = retrieveCandidateContext(intent);
      return {
        catalogSize: context.catalogSize,
        entries: context.entries,
        priceByCanonicalId: context.priceByCanonicalId,
        qualityByCanonicalId: context.qualityByCanonicalId,
      };
    },
    tryModelSelection: llmConfig
      ? async (pool) => {
          const selection = await selectCatalogCandidatesWithLlm({ intent, candidates: pool, config: llmConfig });
          if (!selection.ok) return null;
          modelNote = `大模型只在 ${Object.keys(selection.data.selectedIds).length} 个质量达标候选类别中提出选择，规格和兼容性仍由系统核验。`;
          return {
            selectedIds: selection.data.selectedIds,
            rationaleByCategory: selection.data.rationaleByCategory,
          };
        }
      : undefined,
    tryModelSwap: llmConfig
      ? async (swapInput) => {
          const proposal = await proposeSwapWithLlm({ ...swapInput, config: llmConfig });
          if (!proposal.ok) return null;
          return proposal.data;
        }
      : undefined,
  });
  events.push(
    event(
      run.id,
      "retrieving",
      "completed",
      `本地目录就绪（${outcome.catalogSize.toLocaleString("zh-CN")} 条）；质量门（verified/supported）后有效候选 ${outcome.poolSize} 条${
        outcome.missingCategories.length > 0 ? `，缺类别：${outcome.missingCategories.join("、")}` : ""
      }。`,
    ),
  );
  if (modelNote) {
    events.push(event(run.id, "composing", "completed", modelNote));
  } else if (llmConfig) {
    events.push(event(run.id, "composing", "waiting", `大模型选件不可用（${outcome.fallbackReason ?? "无可用输出"}），已回退到本地规则式候选。`));
  }

  const proposal = outcome.proposal;
  if (!proposal) {
    // Runtime 判定不可回答（池空 / 候选不足 / grounding 阻断）：如实转为追问，绝不硬凑
    const questionMessage =
      outcome.status === "empty_pool"
        ? "目录中暂时没有通过质量门的候选（verified/supported），不能凑出可信方案。请先在目录审核流程中补充证据，再回来生成方案。"
        : outcome.status === "insufficient"
          ? `以下类别没有通过质量门的目录候选：${outcome.missingCategories.join("、")}。方案不会用资料不足的型号凑数；可在目录中补充证据后重试。`
          : "方案存在无法回溯来源的主张，已被验证器阻止。请稍后重试或调整目标。";
    events.push(event(run.id, "question", "waiting", questionMessage));
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    return { request, proposal: null, run, changes: [], versions: [] };
  }

  events.push(event(run.id, "composing", "completed", `已生成 ${proposal.items.length} 个核心配件候选。`));
  events.push(event(run.id, "validating", "started", "正在自动检查主要硬件之间的兼容关系。"));
  events.push(event(run.id, "validating", "completed", proposal.compatibility.message));
  events.push(event(run.id, "validating", "completed", "候选、价格与兼容事实由本地目录、价格证据和规则引擎核验，模型不参与事实判断。"));
  events.push(event(run.id, "completed", "completed", "方案已准备好，可以接受、调整或进入高级 DIY。"));

  saveDesignProposal(proposal);
  run.proposalId = proposal.id;
  run.status = "completed";
  run.completedAt = now();
  saveAgentRun(run);
  request.status = "ready_to_review";
  request.updatedAt = now();
  updateDesignRequestStatus(request.id, request.status);
  return { request, proposal, run, changes: [], versions: [proposal] };
}

export function getDesignResult(requestId: string): DesignResult | null {
  const request = findDesignRequest(requestId);
  if (!request) return null;
  const proposal = findLatestProposal(requestId) ?? null;
  const run = findRunForRequest(requestId);
  if (!run) return null;
  const changes = proposal
    ? diffProposals(findPreviousProposal(requestId, proposal.version) ?? null, proposal)
    : [];
  return { request, proposal, run, changes, versions: findProposals(requestId) };
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
    // 字段质量层与证据引用随方案下传（内核恢复 Task A）：gateFieldQuality 由此真正生效
    addBuildItem(build.id, {
      category: item.category,
      label: item.label,
      spec: item.spec,
      source: item.catalogId ? `catalog:${item.catalogId}` : undefined,
      fieldQuality: Object.keys(item.fieldQuality).length > 0 ? item.fieldQuality : undefined,
      evidenceSourceIds: item.evidenceSourceIds.length > 0 ? item.evidenceSourceIds : undefined,
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

/**
 * 自然语言修订（M31）：双轨理解——LLM 优先（改写完整意图），失败/未配走本地规则
 * （预算调整 + 已有硬件两类）；都理解不了时创建"追问"运行并保留原方案，绝不硬猜。
 * 每次成功修订生成新版本方案（旧版标记 replaced，已接受的不动），并自动重新校验。
 */
export async function reviseDesign(requestId: string, instructionInput: unknown): Promise<DesignResult> {
  const { instruction } = designRevisionInputSchema.parse(instructionInput);
  const request = findDesignRequest(requestId);
  if (!request) throw new Error("DESIGN_REQUEST_NOT_FOUND");
  const latest = findLatestProposal(requestId);
  const { run, events } = createRun(requestId);

  if (!latest) {
    events.push(event(run.id, "question", "waiting", "还没有可调整的方案——先完成第一次生成再来调整。"));
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    return { request, proposal: null, run, changes: [], versions: [] };
  }

  const llmConfig = resolveLlmConfigFromEnv();
  let updatedIntent: StructuredIntent | null = null;
  let note = "";
  let fallbackReason = "";
  if (llmConfig) {
    const llmResult = await reviseIntentWithLlm({
      currentIntent: request.intent,
      instruction,
      config: llmConfig,
    });
    if (llmResult.ok) {
      updatedIntent = llmResult.data;
      note = `大模型（${llmConfig.model}）已理解调整要求。`;
    } else {
      fallbackReason = llmResult.reason;
    }
  }
  if (!updatedIntent) {
    const rules = reviseIntentWithRules(request.intent, instruction);
    if (rules.ok) {
      updatedIntent = rules.intent;
      note = note
        ? `大模型不可用（${fallbackReason}），本地规则已理解调整：${rules.changes.join("；")}。`
        : `已理解调整：${rules.changes.join("；")}。`;
    }
  }

  if (!updatedIntent) {
    const capability = llmConfig
      ? `（大模型不可用：${fallbackReason}；本地规则只能处理预算和已有硬件类调整）`
      : "（未配置大模型，本地规则只能处理预算和已有硬件类调整）";
    events.push(event(run.id, "understanding", "started", "正在理解你的调整要求。"));
    events.push(
      event(
        run.id,
        "question",
        "waiting",
        `我没能理解这条调整："${instruction}"。${capability}你可以换个说法，或直接进入高级 DIY 修改。`,
      ),
    );
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    return { request, proposal: latest, run, changes: [], versions: findProposals(requestId) };
  }

  events.push(event(run.id, "understanding", "started", "正在理解你的调整要求。"));
  events.push(event(run.id, "understanding", "completed", note));
  events.push(event(run.id, "retrieving", "started", "正在检索目录和已核验规格。"));
  const context = retrieveCandidateContext(updatedIntent);
  const version = nextProposalVersion(requestId);
  let preferredIds;
  let rationaleByCategory;
  if (llmConfig) {
    const selection = await selectCatalogCandidatesWithLlm({ intent: updatedIntent, candidates: context.pool, config: llmConfig });
    if (selection.ok) {
      preferredIds = selection.data.selectedIds;
      rationaleByCategory = selection.data.rationaleByCategory;
      events.push(event(run.id, "composing", "completed", `大模型只在质量达标候选中调整第 ${version} 版，系统会重新检查全部兼容关系。`));
    } else {
      events.push(event(run.id, "composing", "waiting", `大模型选件不可用（${selection.reason}），已回退到本地规则式候选。`));
    }
  }
  const proposal = composeOrAsk({
    requestId,
    intent: updatedIntent,
    context,
    version,
    preferredIds,
    rationaleByCategory,
    run,
    events,
  });
  if (!proposal) {
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    // 修订后候选不足：保留原方案并如实告知（旧版本仍是有效的审阅对象）
    return { request, proposal: latest, run, changes: [], versions: findProposals(requestId) };
  }
  events.push(event(run.id, "completed", "completed", `第 ${version} 版已就绪：可继续调整、接受，或进入高级 DIY。`));

  saveDesignProposal(proposal);
  markProposalsReplaced(requestId, proposal.id);
  run.proposalId = proposal.id;
  run.status = "completed";
  run.completedAt = now();
  saveAgentRun(run);
  updateDesignRequestIntent(request.id, updatedIntent, "ready_to_review");
  return {
    request: { ...request, intent: updatedIntent, status: "ready_to_review" as const },
    proposal,
    run,
    changes: diffProposals(latest, proposal),
    versions: findProposals(requestId),
  };
}
