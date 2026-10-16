import { randomUUID } from "node:crypto";
import { designRequestInputSchema, designRevisionInputSchema, type AgentEvent, type AgentRun, type DesignProposal, type DesignRequest, type DesignResult, type ExperienceAdviceItem, type StructuredIntent } from "@/contracts/design";
import { loadSourcedCatalog } from "@/infra/catalog-import/load";
import { resolveLlmConfigFromEnv, type LlmConfig } from "@/infra/llm/client";
import { generateExperienceAdvice } from "./advice-llm";
import { parseIntentWithLlm, proposeSwapWithLlm, reviseIntentWithLlm, selectCatalogCandidatesWithLlm } from "./intent-llm";
import { loadPriceContext } from "./price-context";
import { parseDesignIntent, intentNeedsInput, followupQuestionFor } from "@/domain/design/intent";
import { classifyRevision } from "@/domain/design/revision-route";
import { buildExplainAnswer, renderAnswerDraft } from "@/domain/design/explain";
import { reviseIntentWithRules } from "@/domain/design/revision";
import { buildConversationContext } from "@/domain/design/conversation-context";
import { INTENT_FIELD_LABELS, mergeRevisionIntent, type IntentField, type RevisionMergeResult } from "@/domain/design/revision-merge";
import { diffProposals } from "@/domain/design/diff";
import { generateDesignProposal, type CandidateQualityContext } from "@/domain/design/proposal";
import { buildCategoryCandidates, type CandidateSummary } from "@/domain/catalog/ranking";
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
  countAgentRuns,
} from "@/infra/db/repositories/design-repository";
import { createBuild, addBuildItem, checkBuild, getBuild } from "@/application/builds/service";
import { decorateProposalItems } from "@/infra/catalog-import/display-names";
import { createAgentAttempt, orchestrateDesignGeneration, type ModelSelection } from "@/application/agent/orchestrator";
import { CATALOG_SELECTION_PROMPT_VERSION, REVISION_PROMPT_VERSION } from "./intent-llm";
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

/** 压缩候选池（选件降级阶梯）：每类只保留排序前 N 条——只减量不改字段，"事实存活"纪律不变 */
function compressCandidatePoolForRetry<T extends { category: BuildItemCategory }>(
  pool: readonly T[],
  perCategory: number,
): T[] {
  const counts = new Map<BuildItemCategory, number>();
  return pool.filter((candidate) => {
    const seen = counts.get(candidate.category) ?? 0;
    if (seen >= perCategory) return false;
    counts.set(candidate.category, seen + 1);
    return true;
  });
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

/** 内核恢复管线（Task A/B/C）+ M2 分桶召回：目录 → 质量门 + 分桶/动态 K → 价格上下文 → 候选池 + 字段质量层 */
function retrieveCandidateContext(
  intent: StructuredIntent,
  queries: string[] = [],
): {
  catalogSize: number;
  entries: ReturnType<typeof loadSourcedCatalog>["entries"];
  priceByCanonicalId: Map<string, VerifiedPriceFact>;
  pool: CandidateSummary[];
  missingCategories: BuildItemCategory[];
  qualityByCanonicalId: Map<string, CandidateQualityContext>;
} {
  const { entries, dbBacked } = loadSourcedCatalog();
  const priceByCanonicalId = loadPriceContext({ region: intent.region });
  const pool: CandidateSummary[] = [];
  const missingCategories: BuildItemCategory[] = [];
  for (const category of CANDIDATE_CATEGORIES) {
    const { candidates, stats } = buildCategoryCandidates({ entries, category, intent, priceByCanonicalId, queries });
    if (stats.pooled === 0) missingCategories.push(category);
    pool.push(...candidates);
  }
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
    const emptyMessage = "目录中暂时没有通过质量门的候选（verified/supported），不能凑出可信方案。可以先放宽预算、换个说法重试，或进入高级 DIY 手动选件；也可以在目录审核流程中补充证据后再来。";
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
    const insufficientMessage = `以下类别没有通过质量门的目录候选：${generated.missingCategories.join("、")}。方案不会用资料不足的型号凑数；可补充证据后重试，或进入高级 DIY 自行补齐该类别。`;
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
  return decorateProposal(generated.proposal);
}

/**
 * 给方案挂中文展示名（展示层，label 不改）。
 * 读库路径由 design-repository 的 mapProposal 挂过一次，这里覆盖"生成后直接返回"的内存路径；
 * 重复挂载幂等——decorateProposalItems 只认 catalogId，不看已有展示字段。
 */
function decorateProposal(proposal: DesignProposal): DesignProposal {
  return { ...proposal, items: decorateProposalItems(proposal.items) };
}

/** 修订轮审计（M1）：before/instruction/model/merged + 字段清单整体落 agent_event_log */
function emitRevisionMerged(
  emitRig: (payload: RigEvent) => void,
  runId: string,
  instruction: string,
  before: StructuredIntent,
  model: StructuredIntent,
  merge: RevisionMergeResult,
): void {
  emitRig({
    type: "revision_merged",
    runId,
    instruction,
    beforeIntent: before,
    modelIntent: model,
    mergedIntent: merge.intent,
    changedFields: [...merge.changedFields],
    rejectedFields: [...merge.rejectedFields],
  });
}

function fieldLabels(fields: IntentField[]): string {
  return fields.map((field) => INTENT_FIELD_LABELS[field] ?? field).join("、");
}

/**
 * 混合建议层（hybrid-llm-advice 计划 Task 3）：正式方案生成并完成兼容检查后调用。
 * 建议失败只留 error 事件并返回空数组，绝不阻断、不修改正式方案——
 * 返回值只允许整体附加到 proposal.experienceAdvice，禁止映射成 proposal.items。
 */
async function requestExperienceAdvice(input: {
  runId: string;
  intent: StructuredIntent;
  proposal: DesignProposal;
  candidates: readonly CandidateSummary[];
  config: LlmConfig;
  emit: (payload: RigEvent) => void;
}): Promise<ExperienceAdviceItem[]> {
  const startedAt = now();
  input.emit({
    type: "tool_call", runId: input.runId, tool: "generate_advice", state: "running",
    detail: "大模型整理经验建议与库外线索（不参与正式方案）。", resultIds: [], startedAt, finishedAt: null,
  });
  const result = await generateExperienceAdvice({
    intent: input.intent,
    proposal: {
      title: input.proposal.title,
      budgetCents: input.proposal.budgetCents,
      items: input.proposal.items.map((item) => ({ category: item.category, label: item.label })),
      compatibility: input.proposal.compatibility,
    },
    candidates: input.candidates,
    config: input.config,
    maxTokens: 1000,
  });
  if (!result.ok) {
    input.emit({
      type: "tool_call", runId: input.runId, tool: "generate_advice", state: "error",
      detail: `经验建议不可用（${result.reason}），正式方案不受影响。`, resultIds: [], startedAt, finishedAt: now(),
    });
    return [];
  }
  input.emit({
    type: "tool_call", runId: input.runId, tool: "generate_advice", state: "done",
    detail: result.data.length > 0
      ? `已整理 ${result.data.length} 条建议；待验证产品不进入正式方案。`
      : "模型认为当前没有值得补充的建议。",
    resultIds: [], startedAt, finishedAt: now(),
  });
  return result.data;
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
  let llmFollowup: string | undefined;
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
      // M5 评测结论（data/evals/intent-report.json）：关思考质量持平（预算 96.7%=96.7%、F1 97.1 vs 95.4）、延迟降 3 倍（1.9s vs 5.7s）——意图通道不值得思考
      thinking: "disabled",
      maxTokens: 1500,
    });
    if (llmResult.ok) llmFollowup = llmResult.followupQuestion;
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
    const followup = llmFollowup ?? followupQuestionFor(intent);
    events.push(event(run.id, "question", "waiting", followup));
    emit(runId, { type: "question", runId, message: followup });
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
    // 思考模型的选件调用实测可到 60s+：截止预算 env 化（默认 20s 保持无 LLM 场景不变）
    deadlineMs: Number(process.env.RIGMATE_LLM_ATTEMPT_DEADLINE_MS) > 0
      ? Number(process.env.RIGMATE_LLM_ATTEMPT_DEADLINE_MS)
      : 20_000,
  });
  let modelNote: string | null = null;
  // 富事件侧的相位游标：区分主链推进与同相位过程事件（见 rigPayloadsFromRuntimeEvent）
  let rigLastPhase: AgentPhase | null = null;
  const outcome = await orchestrateDesignGeneration({
    requestId,
    intent,
    attempt,
    // M2 分桶召回：原始目标里的型号短语激活 exact/alias 桶
    modelQueries: [data.rawInput],
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
          // 策略阶梯（对齐 ZCode"分类失败 + 预算内重试 + 结构事实保留"的成熟语义）：
          // ① 全量池 + 关思考（M6 A/B：思考在选件上无稳定增益且 33% 超时）→
          // ② 失败 → 压缩池（每类前 4，只减量不改字段，事实存活）→ ③ 仍失败 → null，
          // 由同一 CandidateSet 的规则排序兜底。
          const attemptSelection = async (candidates: readonly CandidateSummary[], stage: string): Promise<{
            ok: boolean;
            value?: ModelSelection;
          }> => {
            const selectionStartedAt = now();
            const compressedNote = stage === "compressed" ? "（压缩池 · 关思考）" : "";
            emit(runId, {
              type: "tool_call", runId, tool: "select_catalog_candidates", state: "running",
              detail: `大模型在质量达标候选中挑选${compressedNote}。`, resultIds: [], startedAt: selectionStartedAt, finishedAt: null,
            });
            const selection = await selectCatalogCandidatesWithLlm({
              intent,
              candidates,
              config: llmConfig,
              // M6 A/B 评测（evals:live 开关对照）：关思考 6/6 过守卫（开思考 4/6、两例 70s 超时）、
              // 延迟约一半、组合质量反而更优（模型更优 2 vs 0）——选件通道思考无稳定增益，全阶梯关闭
              thinking: "disabled",
              maxTokens: 3000,
            });
            if (!selection.ok) {
              emit(runId, {
                type: "tool_call", runId, tool: "select_catalog_candidates", state: "error",
                detail: `${selection.reason}${compressedNote}`, resultIds: [], startedAt: selectionStartedAt, finishedAt: now(),
              });
              return { ok: false };
            }
            modelNote = `大模型只在 ${Object.keys(selection.data.selectedIds).length} 个质量达标候选类别中提出选择，规格和兼容性仍由系统核验。${compressedNote}`;
            emit(runId, {
              type: "tool_call", runId, tool: "select_catalog_candidates", state: "done",
              detail: modelNote, resultIds: Object.values(selection.data.selectedIds),
              startedAt: selectionStartedAt, finishedAt: now(),
            });
            return {
              ok: true,
              value: {
                selectedIds: selection.data.selectedIds,
                rationaleByCategory: selection.data.rationaleByCategory,
              },
            };
          };
          const full = await attemptSelection(pool, "full");
          if (full.ok && full.value) return full.value;
          const compressedPool = compressCandidatePoolForRetry(pool, 4);
          if (compressedPool.length === pool.length) return null;
          const compressed = await attemptSelection(compressedPool, "compressed");
          return compressed.ok && compressed.value ? compressed.value : null;
        }
      : undefined,
    tryModelSwap: llmConfig
      ? async (swapInput) => {
          const swapStartedAt = now();
          // 换件是小型决策：先按全局思考策略跑；出错（超时/瞬态）关思考再试一次——
          // 两次都失败或模型诚实认为无更优（ok+null）→ 该类别保留原件，规则安全网不受影响
          let proposal = await proposeSwapWithLlm({ ...swapInput, config: llmConfig, maxTokens: 1200 });
          if (!proposal.ok) {
            proposal = await proposeSwapWithLlm({ ...swapInput, config: llmConfig, thinking: "disabled", maxTokens: 1200 });
          }
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
        ? "目录中暂时没有通过质量门的候选（verified/supported），不能凑出可信方案。可以先放宽预算、换个说法重试，或进入高级 DIY 手动选件；也可以在目录审核流程中补充证据后再来。"
        : outcome.status === "insufficient"
          ? `以下类别没有通过质量门的目录候选：${outcome.missingCategories.join("、")}。方案不会用资料不足的型号凑数；可补充证据后重试，或进入高级 DIY 自行补齐该类别。`
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
  // 混合建议层：正式方案已就绪，advice 只增补、失败即空（不改变上方任何事实事件）
  const experienceAdvice = llmConfig
    ? await requestExperienceAdvice({
        runId,
        intent,
        proposal,
        candidates: outcome.pool,
        config: llmConfig,
        emit: (payload) => emit(runId, payload),
      })
    : [];
  const finalProposal: DesignProposal = { ...proposal, experienceAdvice };
  events.push(event(run.id, "completed", "completed", "方案已准备好，可以接受、调整或进入高级 DIY。"));

  saveDesignProposal(finalProposal);
  emit(runId, { type: "proposal", runId, proposalId: finalProposal.id, version: finalProposal.version, title: finalProposal.title });
  emit(runId, { type: "run_completed", runId, status: "ok" });
  run.proposalId = finalProposal.id;
  run.status = "completed";
  run.completedAt = now();
  saveAgentRun(run);
  request.status = "ready_to_review";
  request.updatedAt = now();
  updateDesignRequestStatus(request.id, request.status);
  return { request: { ...request, intent, status: "ready_to_review" as const }, proposal: finalProposal, run, changes: [], versions: [finalProposal] };
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
    // 修订运行的主调用是意图改写：promptVersion 标 revision（M3 registry 完整化）
    promptVersion: REVISION_PROMPT_VERSION,
  });

  let updatedIntent: StructuredIntent | null = null;
  let note = "";
  let fallbackReason = "";
  // M3 快速路由：确定性分类器先决定走法——规则能处理不调模型，问句不重新生成
  const revisionRoute = latest ? classifyRevision(instruction) : "llm";
  if (latest && revisionRoute === "question") {
    // 说明类问题：能定位方案内类别时给确定性解释（M4 AnswerDraft，模型零参与），
    // 定位不到再回落到通用指引；方案与版本保持不动（blueprint §2：不重新生成）
    const draft = buildExplainAnswer({ instruction, proposal: latest });
    const guidance = draft
      ? renderAnswerDraft(draft)
      : "这是说明类问题，不用改方案。每件配置的入选理由与取舍在「为什么这样搭配 / 取舍说明」里可展开查看；要调整配置直接说改哪里，例如「换成白色机箱」。";
    events.push(event(run.id, "understanding", "started", "正在理解你的问题。"));
    events.push(event(run.id, "question", "waiting", guidance));
    emitRig({ type: "phase", runId, phase: "understanding", message: "这是说明类问题，不重新生成方案。" });
    if (draft) {
      // 结构化回答卡（M6）：summary/actions 分离渲染，不冒充追问
      emitRig({ type: "answer", runId, summary: draft.summary, actions: [...draft.actions] });
    } else {
      emitRig({ type: "question", runId, message: guidance });
    }
    emitRig({ type: "run_completed", runId, status: "needs_input" });
    run.status = "completed";
    run.completedAt = now();
    saveAgentRun(run);
    return { request, proposal: latest, run, changes: [], versions: findProposals(requestId) };
  }
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
      const stillMissing = followupQuestionFor(request.intent);
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
  } else if (llmConfig && revisionRoute === "llm") {
    const reviseStartedAt = now();
    emitRig({
      type: "tool_call", runId, tool: "revise_intent", state: "running",
      detail: "大模型理解调整要求。", resultIds: [], startedAt: reviseStartedAt, finishedAt: null,
    });
    const llmResult = await reviseIntentWithLlm({
      currentIntent: request.intent,
      instruction,
      context: buildConversationContext({
        requestId,
        turn: countAgentRuns(requestId) + 1,
        intent: request.intent,
        latestProposal: latest,
        userMessages: [instruction],
      }),
      config: llmConfig,
      maxTokens: 1200,
    });
    if (llmResult.ok) {
      // M1 合并守卫：模型只被允许改动用户明确触及的字段，漂移字段还原 before 值
      const merge = mergeRevisionIntent({ before: request.intent, instruction, modelIntent: llmResult.data });
      updatedIntent = merge.intent;
      note = `大模型（${llmConfig.model}）已理解调整要求。`;
      if (merge.rejectedFields.length > 0) {
        note += `已忽略对未提及字段（${fieldLabels(merge.rejectedFields)}）的改动。`;
      }
      emitRig({
        type: "tool_call", runId, tool: "revise_intent", state: "done",
        detail: note, resultIds: [], startedAt: reviseStartedAt, finishedAt: now(),
      });
      emitRevisionMerged(emitRig, runId, instruction, request.intent, llmResult.data, merge);
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
      // 规则路径同样过合并守卫：审计口径统一（规则只改触达字段，通常无 rejected）
      const merge = mergeRevisionIntent({ before: request.intent, instruction, modelIntent: rules.intent });
      updatedIntent = merge.intent;
      note = note
        ? `大模型不可用（${fallbackReason}），本地规则已理解调整：${rules.changes.join("；")}。`
        : `已理解调整：${rules.changes.join("；")}。`;
      emitRevisionMerged(emitRig, runId, instruction, request.intent, rules.intent, merge);
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
  // M2 分桶召回：修订指令与已有部件里的型号短语激活 exact/alias 桶
  const context = retrieveCandidateContext(updatedIntent, [instruction, ...updatedIntent.existingParts]);
  const version = nextProposalVersion(requestId);
  let preferredIds;
  let rationaleByCategory;
  if (llmConfig) {
    const selectionStartedAt = now();
    emitRig({
      type: "tool_call", runId, tool: "select_catalog_candidates", state: "running",
      detail: `大模型在质量达标候选中调整第 ${version} 版。`, resultIds: [], startedAt: selectionStartedAt, finishedAt: null,
    });
    const selection = await selectCatalogCandidatesWithLlm({ intent: updatedIntent, candidates: context.pool, config: llmConfig, maxTokens: 3000 });
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
  // 混合建议层：新版本生成后同样增补 advice，失败即空（不改变版本与差异语义）
  const experienceAdvice = llmConfig
    ? await requestExperienceAdvice({
        runId,
        intent: updatedIntent,
        proposal,
        candidates: context.pool,
        config: llmConfig,
        emit: emitRig,
      })
    : [];
  const finalProposal: DesignProposal = { ...proposal, experienceAdvice };
  events.push(event(run.id, "completed", "completed", revisionReadyMessage));
  emitRig({ type: "phase", runId, phase: "answered", message: revisionReadyMessage });

  saveDesignProposal(finalProposal);
  markProposalsReplaced(requestId, finalProposal.id);
  emitRig({ type: "proposal", runId, proposalId: finalProposal.id, version: finalProposal.version, title: finalProposal.title });
  emitRig({ type: "run_completed", runId, status: "ok" });
  run.proposalId = finalProposal.id;
  run.status = "completed";
  run.completedAt = now();
  saveAgentRun(run);
  updateDesignRequestIntent(request.id, updatedIntent, "ready_to_review");
  return {
    request: { ...request, intent: updatedIntent, status: "ready_to_review" as const },
    proposal: finalProposal,
    run,
    changes: diffProposals(latest, finalProposal),
    versions: findProposals(requestId),
  };
}
