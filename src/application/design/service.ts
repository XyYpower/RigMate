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
import type { AgentPhase, AgentRuntimeEvent } from "@/application/agent/runtime-types";
import { publishRigEvent } from "@/infra/events/design-event-bus";
import { appendAgentEventLogEntry, nextAgentEventSeq } from "@/infra/db/repositories/agent-event-log-repository";
import type { RigEnvelope, RigEvent } from "@/contracts/agent-events";
import type { VerifiedPriceFact } from "@/domain/catalog/ranking";
import type { BuildItemCategory } from "@/domain/build/types";

function now(): string {
  return new Date().toISOString();
}

/**
 * 富事件发射器（agent-ui P1）：每条事件实时落库 + 广播，seq 在 request 内跨 run 连续。
 * P2 起前端时间线直接消费这条流；现有 AgentEvent 降维层在 P2 切换后退役。
 */
function createRigEmitter(requestId: string): (runId: string, payload: RigEvent) => void {
  let seq = nextAgentEventSeq(requestId);
  return (runId, payload) => {
    const envelope: RigEnvelope = {
      id: `evt-${randomUUID()}`,
      seq: seq++,
      requestId,
      runId,
      at: now(),
      payload,
    };
    appendAgentEventLogEntry(envelope);
    publishRigEvent(envelope);
  };
}

/** runtime 审计事件 → 富事件（agent-ui P1）。同名工具的批量留痕合并为一条，避免刷屏。 */
export function rigPayloadsFromRuntimeEvent(
  event: AgentRuntimeEvent,
  runId: string,
  lastPhase: AgentPhase | null,
): RigEvent[] {
  if (event.phase === "anomaly") {
    return [{
      type: "anomaly",
      runId,
      message: event.message,
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      ...(event.fallback ? { fallback: event.fallback } : {}),
    }];
  }
  const isAdvance = event.phase !== lastPhase;
  if (!isAdvance && (!event.toolCalls || event.toolCalls.length === 0)) {
    // 同相位过程注记（换件迭代等）：作为该相位下的时间线条目
    return [{ type: "phase", runId, phase: event.phase, message: event.message }];
  }
  const out: RigEvent[] = [];
  if (isAdvance) {
    out.push({ type: "phase", runId, phase: event.phase, message: event.message });
  }
  if (event.toolCalls && event.toolCalls.length > 0) {
    const resultIdsByTool = new Map<string, string[]>();
    for (const call of event.toolCalls) {
      const ids = resultIdsByTool.get(call.tool) ?? [];
      ids.push(...call.resultIds);
      resultIdsByTool.set(call.tool, ids);
    }
    const first = event.toolCalls[0]!;
    for (const [tool, resultIds] of resultIdsByTool) {
      out.push({
        type: "tool_call",
        runId,
        tool,
        state: "done",
        detail: event.message,
        resultIds,
        startedAt: first.startedAt,
        finishedAt: first.finishedAt,
      });
    }
  }
  return out;
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
  /** 富事件发射器（agent-ui P1）：与旧 AgentEvent 逐条对应；失败路径自行 emit run_completed */
  emitRig?: (payload: RigEvent) => void;
}): DesignResult["proposal"] {
  const context = input.context;
  const emitRig = input.emitRig;
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
  emitRig?.({
    type: "phase", runId: input.run.id, phase: "retrieved",
    message: `本地目录就绪（${context.catalogSize.toLocaleString("zh-CN")} 条）；质量门后有效候选 ${context.pool.length} 条。`,
  });
  if (context.pool.length === 0) {
    const emptyMessage = "目录中暂时没有通过质量门的候选（verified/supported），不能凑出可信方案。请先在目录审核流程中补充证据，再回来生成方案。";
    input.events.push(event(input.run.id, "question", "waiting", emptyMessage));
    emitRig?.({ type: "question", runId: input.run.id, message: emptyMessage });
    emitRig?.({ type: "run_completed", runId: input.run.id, status: "empty_pool" });
    return null;
  }
  input.events.push(event(input.run.id, "composing", "started", "正在组合一套兼顾用途、预算和外观的方案。"));
  emitRig?.({ type: "phase", runId: input.run.id, phase: "composed", message: "正在组合一套兼顾用途、预算和外观的方案。" });
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
    const insufficientMessage = `以下类别没有通过质量门的目录候选：${generated.missingCategories.join("、")}。方案不会用资料不足的型号凑数；可在目录中补充证据后重试。`;
    input.events.push(event(input.run.id, "question", "waiting", insufficientMessage));
    emitRig?.({ type: "question", runId: input.run.id, message: insufficientMessage });
    emitRig?.({ type: "run_completed", runId: input.run.id, status: "insufficient" });
    return null;
  }
  input.events.push(event(input.run.id, "composing", "completed", `已生成 ${generated.proposal.items.length} 个核心配件候选。`));
  input.events.push(event(input.run.id, "validating", "started", "正在自动检查主要硬件之间的兼容关系。"));
  input.events.push(event(input.run.id, "validating", "completed", generated.proposal.compatibility.message));
  input.events.push(event(input.run.id, "validating", "completed", "候选、价格与兼容事实由本地目录、价格证据和规则引擎核验，模型不参与事实判断。"));
  input.events.push(event(input.run.id, "completed", "completed", "方案已准备好，可以接受、调整或进入高级 DIY。"));
  emitRig?.({ type: "phase", runId: input.run.id, phase: "validated", message: generated.proposal.compatibility.message });
  return generated.proposal;
}

export async function createDesignRequest(
  input: unknown,
  options: { onStarted?: (requestId: string) => void } = {},
): Promise<DesignResult> {
  const data = designRequestInputSchema.parse(input);
  const requestId = randomUUID();
  const timestamp = now();

  // run 与富事件发射器先行（agent-ui P1）：意图解析的模型调用也实时留痕
  const { run, events } = createRun(requestId);
  const runId = run.id;
  const emit = createRigEmitter(requestId);
  emit(runId, { type: "user_message", runId, text: data.rawInput });

  // 意图理解：配了 LLM 用模型（失败自动降级），没配直接走本地规则——两条路都如实告知用户
  const llmConfig = resolveLlmConfigFromEnv();
  emit(runId, {
    type: "run_started",
    runId,
    model: llmConfig?.model ?? "rule-engine",
    promptVersion: CATALOG_SELECTION_PROMPT_VERSION,
  });
  // 规则基线先落库（agent-ui P3）：LLM 理解期间请求行已存在，会话页与事件流可立即订阅
  let intent = parseDesignIntent(data);
  let intentNote = "本地规则理解目标（未配置大模型）。";
  const request: DesignRequest = {
    id: requestId,
    rawInput: data.rawInput,
    intent,
    status: intentNeedsInput(intent) ? "needs_input" as const : "generating" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  saveDesignRequest(request);
  options.onStarted?.(requestId);
  if (llmConfig) {
    const intentStartedAt = now();
    emit(runId, {
      type: "tool_call", runId, tool: "parse_intent", state: "running",
      detail: "大模型解析预算、用途与偏好。", resultIds: [], startedAt: intentStartedAt, finishedAt: null,
    });
    const llmResult = await parseIntentWithLlm({
      rawInput: data.rawInput,
      explicitBudgetYuan: data.budgetCents !== null && data.budgetCents !== undefined ? data.budgetCents / 100 : null,
      config: llmConfig,
    });
    if (llmResult.ok) {
      intent = llmResult.data;
      intentNote = `大模型（${llmConfig.model}）已解析预算、用途与偏好。`;
      emit(runId, {
        type: "tool_call", runId, tool: "parse_intent", state: "done",
        detail: intentNote, resultIds: [], startedAt: intentStartedAt, finishedAt: now(),
      });
      updateDesignRequestIntent(requestId, intent, intentNeedsInput(intent) ? "needs_input" : "generating");
    } else {
      intentNote = `大模型不可用（${llmResult.reason}），已用本地规则理解目标。`;
      emit(runId, {
        type: "tool_call", runId, tool: "parse_intent", state: "error",
        detail: intentNote, resultIds: [], startedAt: intentStartedAt, finishedAt: now(),
      });
    }
  }

  events.push(event(run.id, "understanding", "started", "正在理解预算、用途和外观偏好。"));
  events.push(event(run.id, "understanding", "completed", intentNote));
  emit(runId, { type: "phase", runId, phase: "understanding", message: intentNote });
  const finalRequest: DesignRequest = { ...request, intent, status: intentNeedsInput(intent) ? "needs_input" : "generating" };
  if (intentNeedsInput(intent)) {
    events.push(event(run.id, "question", "waiting", "还缺少预算或用途，补充一句目标后我才能开始搭配。"));
    emit(runId, { type: "question", runId, message: "还缺少预算或用途，补充一句目标后我才能开始搭配。" });
    emit(runId, { type: "run_completed", runId, status: "needs_input" });
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    return { request: finalRequest, proposal: null, run, changes: [], versions: [] };
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
  // 富事件侧的相位游标：区分主链推进与同相位过程事件（见 rigPayloadsFromRuntimeEvent）
  let rigLastPhase: AgentPhase | null = null;
  const outcome = await orchestrateDesignGeneration({
    requestId,
    intent,
    attempt,
    categories: CANDIDATE_CATEGORIES,
    onEvent: (runtimeEvent) => {
      for (const payload of rigPayloadsFromRuntimeEvent(runtimeEvent, runId, rigLastPhase)) {
        emit(runId, payload);
      }
      if (runtimeEvent.phase !== "anomaly") rigLastPhase = runtimeEvent.phase;
    },
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
          const selectionStartedAt = now();
          emit(runId, {
            type: "tool_call", runId, tool: "select_catalog_candidates", state: "running",
            detail: "大模型在质量达标候选中挑选。", resultIds: [], startedAt: selectionStartedAt, finishedAt: null,
          });
          const selection = await selectCatalogCandidatesWithLlm({ intent, candidates: pool, config: llmConfig });
          if (!selection.ok) {
            emit(runId, {
              type: "tool_call", runId, tool: "select_catalog_candidates", state: "error",
              detail: selection.reason, resultIds: [], startedAt: selectionStartedAt, finishedAt: now(),
            });
            return null;
          }
          modelNote = `大模型只在 ${Object.keys(selection.data.selectedIds).length} 个质量达标候选类别中提出选择，规格和兼容性仍由系统核验。`;
          emit(runId, {
            type: "tool_call", runId, tool: "select_catalog_candidates", state: "done",
            detail: modelNote, resultIds: Object.values(selection.data.selectedIds),
            startedAt: selectionStartedAt, finishedAt: now(),
          });
          return {
            selectedIds: selection.data.selectedIds,
            rationaleByCategory: selection.data.rationaleByCategory,
          };
        }
      : undefined,
    tryModelSwap: llmConfig
      ? async (swapInput) => {
          const swapStartedAt = now();
          const proposal = await proposeSwapWithLlm({ ...swapInput, config: llmConfig });
          // data = null 是模型的诚实结论（池内没有更优候选），不是错误
          if (!proposal.ok || !proposal.data) {
            emit(runId, {
              type: "tool_call", runId, tool: "propose_swap",
              state: proposal.ok ? "done" : "error",
              detail: proposal.ok ? "模型认为池内没有更优候选。" : proposal.reason,
              resultIds: [], startedAt: swapStartedAt, finishedAt: now(),
            });
            return null;
          }
          emit(runId, {
            type: "tool_call", runId, tool: "propose_swap", state: "done",
            detail: `${proposal.data.category} → ${proposal.data.catalogId}：${proposal.data.reason}`,
            resultIds: [proposal.data.catalogId], startedAt: swapStartedAt, finishedAt: now(),
          });
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
    emit(runId, { type: "question", runId, message: questionMessage });
    emit(runId, { type: "run_completed", runId, status: outcome.status });
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
  emit(runId, { type: "proposal", runId, proposalId: proposal.id, version: proposal.version, title: proposal.title });
  emit(runId, { type: "run_completed", runId, status: "ok" });
  run.proposalId = proposal.id;
  run.status = "completed";
  run.completedAt = now();
  saveAgentRun(run);
  request.status = "ready_to_review";
  request.updatedAt = now();
  updateDesignRequestStatus(request.id, request.status);
  return { request: { ...request, intent, status: "ready_to_review" as const }, proposal, run, changes: [], versions: [proposal] };
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
    // 富事件流：接受是主链终点 answered（agent-ui P1）
    const emitAccepted = createRigEmitter(request.id);
    emitAccepted(run.id, {
      type: "phase", runId: run.id, phase: "answered",
      message: "你已接受这套方案，正式项目和自动检查结果已保存。",
    });
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
  const latest = findLatestProposal(requestId) ?? null;
  const { run, events } = createRun(requestId);
  const runId = run.id;
  const rigEmit = createRigEmitter(requestId);
  const emitRig = (payload: RigEvent) => rigEmit(runId, payload);
  const llmConfig = resolveLlmConfigFromEnv();
  emitRig({ type: "user_message", runId, text: instruction });
  emitRig({
    type: "run_started", runId,
    model: llmConfig?.model ?? "rule-engine",
    promptVersion: CATALOG_SELECTION_PROMPT_VERSION,
  });

  let updatedIntent: StructuredIntent | null = null;
  let note = "";
  let fallbackReason = "";
  if (!latest) {
    // needs_input 会话的补充目标（agent-ui P3）：不再挡回，走意图修订 + 重新生成；
    // 规则修订理解不了时，把补充并入原始描述做一次完整规则理解兜底
    const rules = reviseIntentWithRules(request.intent, instruction);
    if (rules.ok) {
      updatedIntent = rules.intent;
      note = `已理解补充：${rules.changes.join("；")}。`;
    } else {
      const merged = parseDesignIntent({
        rawInput: `${request.rawInput}；${instruction}`,
        budgetCents: null,
        region: request.intent.region,
      });
      if (!intentNeedsInput(merged)) {
        updatedIntent = merged;
        note = "已理解补充，预算与用途齐了，开始搭配。";
      }
    }
    if (!updatedIntent) {
      const stillMissing = "还缺预算或用途——补充一句具体目标（比如「2 万预算，主要玩游戏」）我才能开始搭配。";
      events.push(event(run.id, "question", "waiting", stillMissing));
      emitRig({ type: "question", runId, message: stillMissing });
      emitRig({ type: "run_completed", runId, status: "needs_input" });
      run.status = "completed";
      run.completedAt = now();
      saveAgentRun(run);
      return { request, proposal: null, run, changes: [], versions: [] };
    }
    events.push(event(run.id, "understanding", "started", "正在理解你的补充。"));
    events.push(event(run.id, "understanding", "completed", note));
    emitRig({ type: "phase", runId, phase: "understanding", message: note });
  } else if (llmConfig) {
    const reviseStartedAt = now();
    emitRig({
      type: "tool_call", runId, tool: "revise_intent", state: "running",
      detail: "大模型理解调整要求。", resultIds: [], startedAt: reviseStartedAt, finishedAt: null,
    });
    const llmResult = await reviseIntentWithLlm({
      currentIntent: request.intent,
      instruction,
      config: llmConfig,
    });
    if (llmResult.ok) {
      updatedIntent = llmResult.data;
      note = `大模型（${llmConfig.model}）已理解调整要求。`;
      emitRig({
        type: "tool_call", runId, tool: "revise_intent", state: "done",
        detail: note, resultIds: [], startedAt: reviseStartedAt, finishedAt: now(),
      });
    } else {
      fallbackReason = llmResult.reason;
      emitRig({
        type: "tool_call", runId, tool: "revise_intent", state: "error",
        detail: `大模型不可用（${fallbackReason}）。`, resultIds: [], startedAt: reviseStartedAt, finishedAt: now(),
      });
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
    const misunderstoodMessage = `我没能理解这条调整："${instruction}"。${capability}你可以换个说法，或直接进入高级 DIY 修改。`;
    events.push(event(run.id, "understanding", "started", "正在理解你的调整要求。"));
    events.push(event(run.id, "question", "waiting", misunderstoodMessage));
    emitRig({ type: "phase", runId, phase: "understanding", message: "正在理解你的调整要求。" });
    emitRig({ type: "question", runId, message: misunderstoodMessage });
    emitRig({ type: "run_completed", runId, status: "needs_input" });
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    return { request, proposal: latest, run, changes: [], versions: findProposals(requestId) };
  }

  events.push(event(run.id, "understanding", "started", "正在理解你的调整要求。"));
  events.push(event(run.id, "understanding", "completed", note));
  events.push(event(run.id, "retrieving", "started", "正在检索目录和已核验规格。"));
  emitRig({ type: "phase", runId, phase: "understanding", message: note });
  const context = retrieveCandidateContext(updatedIntent);
  const version = nextProposalVersion(requestId);
  let preferredIds;
  let rationaleByCategory;
  if (llmConfig) {
    const selectionStartedAt = now();
    emitRig({
      type: "tool_call", runId, tool: "select_catalog_candidates", state: "running",
      detail: `大模型在质量达标候选中调整第 ${version} 版。`, resultIds: [], startedAt: selectionStartedAt, finishedAt: null,
    });
    const selection = await selectCatalogCandidatesWithLlm({ intent: updatedIntent, candidates: context.pool, config: llmConfig });
    if (selection.ok) {
      preferredIds = selection.data.selectedIds;
      rationaleByCategory = selection.data.rationaleByCategory;
      events.push(event(run.id, "composing", "completed", `大模型只在质量达标候选中调整第 ${version} 版，系统会重新检查全部兼容关系。`));
      emitRig({
        type: "tool_call", runId, tool: "select_catalog_candidates", state: "done",
        detail: `大模型只在质量达标候选中调整第 ${version} 版。`,
        resultIds: Object.values(selection.data.selectedIds), startedAt: selectionStartedAt, finishedAt: now(),
      });
    } else {
      events.push(event(run.id, "composing", "waiting", `大模型选件不可用（${selection.reason}），已回退到本地规则式候选。`));
      emitRig({
        type: "tool_call", runId, tool: "select_catalog_candidates", state: "error",
        detail: `大模型选件不可用（${selection.reason}）。`, resultIds: [], startedAt: selectionStartedAt, finishedAt: now(),
      });
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
    emitRig: (payload) => emitRig(payload),
  });
  if (!proposal) {
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    // 修订后候选不足：保留原方案并如实告知（旧版本仍是有效的审阅对象）；
    // run_completed 已由 composeOrAsk 按确切原因发出
    return { request, proposal: latest, run, changes: [], versions: findProposals(requestId) };
  }
  const revisionReadyMessage = `第 ${version} 版已就绪：可继续调整、接受，或进入高级 DIY。`;
  events.push(event(run.id, "completed", "completed", revisionReadyMessage));
  emitRig({ type: "phase", runId, phase: "answered", message: revisionReadyMessage });

  saveDesignProposal(proposal);
  markProposalsReplaced(requestId, proposal.id);
  emitRig({ type: "proposal", runId, proposalId: proposal.id, version: proposal.version, title: proposal.title });
  emitRig({ type: "run_completed", runId, status: "ok" });
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
