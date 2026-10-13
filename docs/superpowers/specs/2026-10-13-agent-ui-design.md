# 设计主线 Agent 会话式 UI 改造方案

日期：2026-10-13
状态：设计评审中
范围：设计主线（/design）后端事件流 + 前端会话式改造；管理页（hardware/evidence/review/projects/builds）不动。

---

## 0. 一句话结论

RigMate 的内核已经是 agent 优先的（append-only 事件状态机 + 只读工具 + Claim Ledger），改造成本主要在两处：**把已在采集的 runtime 事件实时发出去（SSE）**，以及**把方案页重写成"事件流投影 + 富卡片"的会话式 UI**。不需要引入聊天框架，也不做纯聊天气泡——结构化配置卡片是本产品的核心表达。

## 1. ZCode 源码研究结论

来源：`github.com/zai-org/ZCode`（本地镜像 `D:\XyyWork\zcode-oss\mirror\`，28 个关键文件）。网络受限环境下逐文件拉取，核心协议与 UI 投影层已读完。

### 1.1 架构本质：事件溯源 + UI 投影

- **会话 = append-only 事件日志**（`packages/contracts/src/events/session.events.ts`）。事件 envelope 统一携带：`eventId / sequenceNumber / type / turnId / spanId / causationEventId / idempotencyKey / artifactRefs`，JSONL 持久化。
- **UI 是事件流的纯函数投影**：`EventReducer.reduce(events) → SessionProjection`；前端 `zcodeSessionProjection.ts` 把事件折叠成消息时间线。刷新、断线、换设备 = 重放事件即可恢复界面，前端不持有独立的会话状态。
- **turn（轮次）是交互单元**：`turn_started → user_message → (model_request → assistant_message → tool_call 循环) → turn_complete / turn_error`；运行中插话走 steer 事件族排队。

### 1.2 流式粒度（值得抄的分层）

| 层 | 事件 |
|---|---|
| 文本 | `text_start / text_delta / text_end` |
| 工具输入 | `tool_input_start / tool_input_delta / tool_input_end` |
| 工具调用 | `tool_call_scheduled / started / progress / result / error` |
| 模型 | `model_request / model_streaming / model_complete / model_error / usage_accounted` |
| 轮次 | `turn_started / turn_input_received / turn_complete / turn_error / turn_cancelled` |
| 权限/异常 | `permission_requested / resolved / denied`；`error_max_budget / error_max_turns / timed_out` |

### 1.3 工具块渲染（ToolCallBlocks）

- **注册表模式**：`renderers.tsx` 为每类工具注册专属 renderer（ExecuteCommand、EditInlineDiff、ask-question、agent…）。
- **统一 ToolLayout**：`icon + kindLabel + primaryText + statusNode + Collapsible body`；运行中显示 `ToolCallProgressIndicator`。
- **大结果不内联**：`artifactRefs` 引用 + `resultPreview` 摘要，点开再取全文。

### 1.4 传输

协议与传输解耦：desktop 走 RPC channel（Electron IPC），浏览器走 relay，同一套事件模型。对 Web 产品，SSE 就是等价物。

## 2. RigMate 现状盘点（改造的起点）

### 2.1 已经是 agent 优先的后端

- `src/application/agent/run-state.ts`：`AgentRunState` 状态机，主链 `received → screened → understanding → retrieved → composed → validated → answered`，`anomaly()` / `log()` 记录异常与过程，**append-only**。
- `src/application/agent/runtime-types.ts`：`AgentRuntimeEvent` 已带 `phase / message / retrievalIds / toolCalls / fallback / errorCode`；`AgentRuntimeOptions.onEvent` 钩子**已定义未接线**。
- `src/application/agent/orchestrator.ts`：`orchestrateDesignGeneration` 产出完整 `runtimeEvents`，但**一次性在结束时返回**。
- `src/application/design/service.ts`：把 runtime 事件**降维**成 8 种 `AgentEvent`（type × 4 status）手工拼装后落库；UI 再用 `stageTrackFromEvents` / `toTimelineSteps` 解析渲染。
- DB 侧：`design-requests / agent-runs / agent-events / design-proposals` 已持久化，已有 `appendAgentEvent` / `findRunForRequest`。

**核心病灶：三套事件模型**（orchestrator 的 `AgentRuntimeEvent` → service 手拼的 `AgentEvent` → UI 组件再解析），信息在降维中丢失（toolCalls、retrievalIds、fallback 到不了 UI），且全部是事后批量。

### 2.2 前端

- `/design/[id]`（364 行）：一次性 GET 渲染整页工作台（BudgetRuler / BuildSummaryCard / AssemblyRail / BuildPartsTable / VerificationDesk / 版本切换 / diff / 修订表单）。加载中是三个假步骤动画。
- 已有组件离会话式 UI 只差一步：`AgentProgressCard`（事件→时间线步骤）、`StageTrack`、`VerificationDesk`。
- 修订（revisions）已是"自然语言进、新版本出"，只差会话式入口。

## 3. 目标形态

```
┌────────────┬──────────────────────────────────────┬─────────────┐
│ 会话列表    │  中栏：消息时间线                      │ 核验台(可选) │
│ (requests) │  ┌────────────────────────────────┐  │ ≥1200px 右栏 │
│            │  │ 用户：2万以内玩黑神话，要白色     │  │             │
│ + 新建会话  │  └────────────────────────────────┘  │ StageTrack  │
│            │  ⚙ 理解目标  已解析预算 ¥20,000/游戏   │ Verification│
│            │  🔍 searchCatalog ×8  命中 194 候选 ▸│ Desk        │
│            │  📎 searchEvidence ×N  证据链核对 ▸  │ (现有组件)   │
│            │  ⚠ 模型回退：规则排序接管（原因…）     │             │
│            │  ┌─ 方案 v1 ─────────────────────┐  │             │
│            │  │ [BudgetRuler 紧凑版]           │  │             │
│            │  │ [部件表 紧凑版]  [兼容性摘要]    │  │             │
│            │  │ [接受] [进 DIY] [继续调整…]     │  │             │
│            │  └───────────────────────────────┘  │             │
│            │  底部输入框：继续调整 / 新目标（常驻） │             │
└────────────┴──────────────────────────────────────┴─────────────┘
```

- 生成过程实时流式：相位步骤逐条点亮、工具块运行中转圈、完成后可折叠看命中明细。
- 结果是**内嵌富卡片**（复用现有 workbench 组件的紧凑模式），不是聊天气泡。
- 历史会话打开 = 重放事件瞬间重建时间线（ZCode 投影思想）。
- `/design/[id]` 的完整工作台视图保留（从方案卡"展开详情"进入），组件全部复用。

## 4. 事件协议设计

### 4.1 统一事件模型（一套模型走完 后端→DB→SSE→UI）

以 `AgentRuntimeEvent` 为唯一事实源扩展，废弃 service 手拼 `AgentEvent` 的降维层：

```ts
// src/contracts/agent-events.ts（新）
export type RigEvent =
  | { type: "run_started";  runId: string; attempt: AgentAttempt }
  | { type: "phase";        runId: string; phase: AgentPhase; message: string }
  | { type: "tool_call";    runId: string; tool: string; state: "running" | "done" | "error";
        startedAt: string; finishedAt?: string; resultIds: string[]; detail?: string }
  | { type: "anomaly";      runId: string; message: string; errorCode?: string;
        fallback?: { reason: string; from: string; to: string } }
  | { type: "question";     runId: string; message: string }
  | { type: "proposal";     runId: string; proposal: DesignProposal; changes: ProposalChange[] }
  | { type: "user_message"; runId: string; text: string }          // 修订指令留痕
  | { type: "run_completed"; runId: string; status: "ok" | "blocked" | "insufficient" | "empty_pool" };

// 统一 envelope（借鉴 ZCode，简化到必要项）
export type RigEnvelope = {
  id: string;            // evt-uuid
  seq: number;           // request 内单调递增：重连续传的游标
  requestId: string;
  at: string;            // ISO
  payload: RigEvent;
};
```

- `seq` 是重连续传的关键：客户端带 `Last-Event-ID`，服务端从 `seq+1` 回放（ZCode stream-recovery 的微缩版）。
- 现有 `stageTrackFromEvents` / `toTimelineSteps` 改为从新模型投影（或写适配函数），E2E 断言随之更新。

### 4.2 流式通道

| 端点 | 行为 |
|---|---|
| `POST /api/design` | 仅创建 request + 启动后台生成，立即 `201 { requestId }`（不再同步等生成完） |
| `GET /api/design/[id]/stream` | SSE：先回放 DB 已有事件，再实时推送；`run_completed` 后关流。`Last-Event-ID` 续传 |
| `GET /api/design/[id]` | 保留：全量快照（request + proposals + 全部事件），刷新恢复用 |
| `POST /api/design/[id]/revisions` | 同样改为 `202` + 走 stream；或直接返回 SSE（fetch ReadableStream） |

- 进程内事件总线：`EventEmitter<{requestId, event}>`（dev/单机部署够用）。多实例部署时再换 Redis pub/sub——在总线接口上留缝即可，不提前建。
- Next.js 16 route handler 原生支持返回 `ReadableStream`（已核对 `node_modules/next/dist/docs`，SSE 用 `text/event-stream` + chunked 即可）。

### 4.3 后端接线（改动集中在三处）

1. **`AgentRunState`**：构造器接受 `onEvent?: (e: AgentRuntimeEvent) => void`，`append()` 时同步通知（`runtime-types.ts` 的钩子设计兑现）。
2. **`orchestrateDesignGeneration`**：透传 `onEvent`；另外把 retrieve 的 8 类目循环改为逐类发 `tool_call`（searchCatalog ×8 天然流式粒度）+ 候选池摘要进 `retrievalIds`。
3. **`service.ts`**：
   - run 创建后：`onEvent = (e) => { bus.publish(requestId, envelope(e)); appendAgentEvent(...); }`——**每事件实时落库**，崩溃/刷新后可回放；
   - LLM 调用点（`parseIntentWithLlm` / `selectCatalogCandidatesWithLlm` / `proposeSwapWithLlm`）前后发 `tool_call`（state: running→done/error），这是将来 live LLM 接入后最大的等待点，现在就把骨架留好；
   - 删除手拼 8 种 `AgentEvent` 的降维代码（`composeOrAsk` 的事件拼装、`event()` 工厂）。

## 5. 前端设计

### 5.1 会话状态层（学 EventReducer，微缩版）

```ts
// src/ui/session/use-design-session.ts
export function useDesignSession(requestId: string) {
  // 1. GET /api/design/[id] → 全量事件 → reduce 出初始 timeline
  // 2. EventSource(/stream) 增量事件 → 逐条 apply
  // 3. 断线自动重连（EventSource 原生）+ Last-Event-ID
  return { timeline, status, proposal, versions, question };
}

type TimelineItem =
  | { kind: "user"; text: string }
  | { kind: "phase"; phase: AgentPhase; message: string; at: string }
  | { kind: "tool"; tool: string; state: "running" | "done" | "error"; resultIds: string[]; detail?: string }
  | { kind: "anomaly"; message: string; fallback?: ... }
  | { kind: "question"; message: string }
  | { kind: "proposal"; proposal: DesignProposal; changes: ProposalChange[] };
```

纯 reducer，事件只追加；时间线去重/排序按 `seq`。

### 5.2 工具块渲染（学 ToolCallBlocks 注册表）

```ts
// src/ui/session/tool-renderers.tsx
const toolRenderers: Record<string, ToolRenderer> = {
  searchCatalog:       { icon: Search,  kindLabel: "检索目录",  summary: (e) => `命中 ${e.resultIds.length} 候选` },
  searchEvidence:      { icon: FileCheck, kindLabel: "证据链核对", summary: ... },
  runCompatibilityCheck:{ icon: ShieldCheck, kindLabel: "兼容性检查", summary: ... },
  selectCatalogCandidatesWithLlm: { icon: Sparkles, kindLabel: "模型选件", ... },
};
```

统一外观：图标 + 类型标签 + 一行摘要 + 状态点（running 转圈 / done 勾 / error 叉），点击折叠展开 `resultIds` chips（候选 ID 可 hover 显示型号名，点击滚动到方案卡对应行）。

### 5.3 页面改造

- `/design`（列表页）→ 会话列表 + 新建入口（替代现在的方案库分组首页，或在其上加会话分组——实现时按信息量取舍）。
- `/design/[id]` → 默认时间线视图（5.1/5.2 + proposal 卡）；现有工作台整页保留为 `?view=workbench` 或方案卡上的"完整视图"链接。右栏核验台（≥1200px）保留。
- 首页 `/` 表单提交后 → 跳转 `/design/[requestId]` 并开始流式渲染（首页不再自己转圈等待）。
- 底部常驻输入框：有方案时语义是修订、无方案时是补充目标/重新生成——后端 `revisions` 已能处理差异，前端一个入口即可。

### 5.4 不做的事

- 不做纯聊天气泡流；不做 markdown 自由文本回复（内核目前不产出自由文本，P4 接 LLM 后再评估）。
- 不动 hardware / evidence / review / projects / builds。
- 不引入状态库/聊天框架（React 19 内置能力 + EventSource 足够）。

## 6. 分期落地

| 期 | 内容 | 验收 | 预估 |
|---|---|---|---|
| **P1 事件流出** | AgentRunState.onEvent、orchestrator 逐类目工具事件、service 实时落库 + 总线、SSE route（回放+续传） | `curl -N /api/design/[id]/stream` 逐条吐事件；杀进程重启后 Last-Event-ID 续传正确；现有测试全绿 | 1-1.5 天 |
| **P2 时间线 UI** | useDesignSession + reducer、时间线组件、3-4 个工具块 renderer、proposal 卡（紧凑版复用）、/design/[id] 默认时间线 | 生成过程逐步点亮；刷新恢复完整时间线；E2E 更新并全绿 | 2-3 天 |
| **P3 会话入口** | 会话列表、底部输入框统一生成/修订、首页表单接入流式跳转 | 从输入到接受全流程在会话页完成；历史会话可继续修订 | 1-2 天 |
| **P4 LLM 增强**（key 到位后） | 文本流式（text_delta 事件）、模型思考展示、多轮上下文修订 | live 评测通过 | 视 LLM 接入而定 |

每期独立提交、门禁全绿、真实数据截图（沿用既定工作流）。P1 完成后 UI 零改动、无风险，P2 起才碰页面。

## 7. 风险与边界

- **SSE 与 Next 16/Turbopack**：route handler 返回 ReadableStream 是官方支持的路径（docs 已核对）；dev 单例无碍，生产多实例需外置 pub/sub（接口已留缝，当前自用单机不阻塞）。
- **事件膨胀**：每 request 事件量 ~30-60 条（8 类目工具块 + 相位 + 模型调用），SQLite 落库无压力；`retrievalIds` 单事件上限沿用现有 max(60) 约束。
- **E2E 兼容**：`design` 页现有断言（region 角色、双挂载 filter visible）在 P2 改造时需同步迁移到时间线结构；P1 不影响。
- **不做假流式**：现在的确定性管线全链路 < 2s，流式主要价值是过程可见与信任；LLM 接入后等待拉长，流式从"好看"变"刚需"——骨架先立，价值后兑。

## 8. P4 策略节：思考预算 / 失败分类 / 域封闭 / 有界自主循环（2026-10-13 live 后补）

接上真实 LLM（GLM 编码套餐 glm-5.3-flash，推理模型）后实测与落地，语义对齐 ZCode `adapters/model`（retry-policy / retry-budget / empty-completion-retry / request-admission），按零依赖规模裁剪：

### 8.1 思考预算（实测驱动）

- glm-5.3-flash 选件级调用（64 候选 JSON）：**思考开启 ~65s**（2572 reasoning tokens），**关闭 7s**。思考是 agent 质量的一部分，默认开启，用预算消化而不是回避。
- 单次调用 `max_tokens`（含思考）按类型给足：意图 1500 / 修订 1200 / 选件 3000 / 换件 1200——既是质量预算也是**成本硬顶**。
- 超时 `RIGMATE_LLM_TIMEOUT_MS=70s`；整轮截止 `RIGMATE_LLM_ATTEMPT_DEADLINE_MS=300s`（env 化，默认 20s 保持无 LLM 场景不变）。

### 8.2 失败分类与退避（client.ts，对齐 ZCode 语义）

- **瞬态可重试**：网络错误 / 429 / 5xx / **空补全**（推理模型把输出预算耗在思考上，等价 ZCode empty-completion-retry）。
- **不重试**：其余 4xx（提示词/鉴权问题）、**超时 abort**（预算已花完，交给调用方策略阶梯）、schema 拒绝（守卫拒绝 = 提示词问题，重试没有意义）。
- 退避曲线：`base*factor^(n-1)` 封顶 maxDelay，jitter 0.5-1.0x，**Retry-After 合理时优先**；参数全部 `RIGMATE_LLM_RETRY_*` 环境可调。

### 8.3 选件策略阶梯（超时后的"回退并重新调整策略"）

```
① 全量池（8/类×8 类=64）+ 思考        —— 质量优先
② 失败 → 压缩池（4/类=32，只减量不改字段，事实存活纪律不变）+ 关思考 —— 速度优先
③ 仍失败 → null → 同一 CandidateSet 的规则排序兜底（既有硬门）
```
每一阶都发 `select_catalog_candidates` 工具事件（running/done/error + 阶段标注），时间线上可见。换件同构：出错关思考重试一次，模型诚实认为无更优（ok+null）不重试。

### 8.4 域封闭（DIY agent vs 编程 agent 的差异设计）

ZCode 是编程 agent，域封闭靠封闭工具注册表 + 权限系统；RigMate 的模型没有代码执行面，封闭按层落地：

1. **输出契约封闭（主边界，最硬）**：全部 LLM 调用走 `.strict()` zod schema，模型唯一出口是域内 JSON（候选 ID 选择 / 意图字段映射）。跑题输出过不了解析 → 失败降级，**系统不存在自由文本回复通道**，被注入也产不出可用输出。
2. **max_tokens 成本顶**：单次调用输出封顶，白嫖经济学不成立。
3. **请求准入（`infra/llm/admission.ts`，借 ZCode 票据端口形态）**：LLM 携带型 HTTP 入口（design 创建 / revisions）过并发（2）+ 窗口（6/分钟）准入，超限 429 + Retry-After；票据 release 幂等，窗口配额不回滚。
4. **结构域门**：跑题输入最多消耗一次意图解析——映射不进意图字段即触发诚实追问，昂贵的选件/换件调用不会发生。
5. 提示词约束只是最外层辅助，不承载封闭职责。

### 8.5 有界自主循环与评测

- 换件迭代：最多 2 轮、只有减少阻断（或同阻断减警告）才采纳（既有），是**有改善门的自主循环**——不做无界 agent loop。
- 样本规模：目录 26k、质量门后池 64（压缩阶梯 32）；选择质量用 `npm run evals:live` 度量（对比 thinking on/off、池 8 vs 4 的选择质量），离线回归 `npm run evals:design`。待运行项。

## 9. 参考

- ZCode 源码镜像：`D:\XyyWork\zcode-oss\mirror\`（session.events.ts / event-reducer.ts / zcodeSessionProjection.ts / ToolCallBlocks/* / session-eventlog.example.jsonl）
- 仓库：`github.com/zai-org/ZCode`（事件溯源、UI 投影、工具块注册表均出自该实现，协议为本项目原创简化版）
