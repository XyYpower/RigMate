# Agent 调用 LLM 与召回增强设计规格

日期：2026-10-14  
状态：待评审  
范围：设计主线（/design）的 Agent 运行时、召回上下文和模型回答链路

## 1. 目标

让用户用自然语言连续描述“预算、用途、偏好、已有硬件和取舍”时，Agent 能：

1. 保留前几轮上下文并准确补齐意图缺口；
2. 从本地质量门目录中召回足够且可解释的候选；
3. 让 LLM 只在已召回候选中做偏好排序和表达；
4. 让规格、价格、兼容性和型号结论全部由系统数据、证据和规则核验；
5. 模型失败、超时或配置错误时，自动回退到同一候选集上的规则路径。

本次先解决 Agent 调用 LLM 的可用性和可信度，不接向量数据库、不做全网搜索、不让模型直接写库，也不把模型自由文本当作事实。

## 2. 现状与病因

当前代码已经具备 LLM JSON 客户端、意图解析、受约束选件、换件、质量门、候选排序、Claim Ledger 和规则回退。问题在于这些能力还没有形成“会话 + 召回 + 回答”的闭环：

- 意图解析每次只看到当前一条输入，没有会话摘要、历史修订和已确认字段；模型只能机械填 JSON，用户感受不到连续对话。
- 目录排序主要按类别、必填完整度、价格和名称命中排序。模型收到的候选虽然安全，但没有按“硬约束 / 事实规格 / 取舍 / 证据”分层，96 条摘要容易淹没真正相关项。
- 选件提示词允许模型写 reason，但没有把理由拆成可验证的事实引用；因此理由可能泛化，无法直接变成可信回答。
- 修订路径没有和首次生成完全相同的压缩池、上下文和验证流程；同一个用户连续调整时，模型看不到上一版选择的原因和兼容结果。
- 运行时已经有富事件和 SSE，但事件只描述“模型在做什么”，没有结构化的“召回了什么、为什么入选、哪些字段未知、回答引用了哪些 claim”。
- LLM 客户端已经有超时、重试和 schema 守卫；缺少调用级 usage/latency 审计和可测试的 provider 兼容降级信息。

所以“模型笨”的首要原因不是换一个更大的模型，而是模型看到的上下文不完整、候选组织不清楚、回答没有独立的 grounding 阶段。

## 3. 方案比较

### 方案 A：在现有链路上增加会话上下文、分层召回和结构化回答（采用）

保留当前 intent-llm、orchestrator、rankCandidates、质量门和规则引擎。新增轻量的会话上下文契约、混合召回适配器、回答 schema 和 claim 验证器。

优点：改动集中、可复用现有审计和回退、没有新增基础设施；模型只能处理小而清楚的候选上下文，最适合当前单机 SQLite 产品。缺点：语义召回能力受本地别名和规则质量影响，需要用评测集持续补别名。

### 方案 B：引入向量库和自由文本 Agent

把目录说明、网页资料和对话全部向量化，由 Agent 自由调用检索工具并生成 Markdown 回答。

暂不采用。结构化硬件规格不能由相似度决定，向量库会增加同步、版本、数据污染和引用校验成本；自由文本也会绕开当前已经建立的 Claim Ledger 和兼容性规则。

### 方案 C：多 Agent 分工（意图、检索、选件、解释各一个模型）

可以提高职责隔离，但会增加延迟、成本和失败组合，当前目录规模和单机部署没有必要。后续若离线评测证明单模型回答不足，再在方案 A 的明确契约上拆分，而不是先引入多 Agent。

## 4. 采用的目标架构

~~~text
用户消息 + 会话摘要
        │
        ▼
意图解析器（严格 JSON） ──失败──▶ 本地规则解析
        │
        ▼
会话状态：已确认字段 / 待补字段 / 已有硬件 / 修订历史
        │
        ▼
混合召回器
  规范化型号/别名召回
  → 类别与硬约束过滤
  → 结构化排序与多样性补召回
  → 证据、价格、字段质量关联
        │
        ▼
候选上下文（每类 6-8 条，分层字段）
        │
        ▼
受约束选件器（只返回候选 ID + 理由码）
        │
        ▼
确定性方案生成 + 兼容规则
        │
        ▼
回答规划器（结构化 AnswerDraft）
        │
        ▼
Claim Ledger 验证 → AnswerViewModel → 时间线/UI
~~~

### 4.1 会话上下文

新增 AgentConversationContext，只保存业务需要的结构化信息：

~~~ts
type AgentConversationContext = {
  requestId: string;
  turn: number;
  rawMessages: Array<{ role: "user" | "assistant"; text: string }>;
  intent: StructuredIntent;
  confirmedFields: string[];
  pendingQuestion: string | null;
  lastProposalId: string | null;
  lastSelectionReasons: Partial<Record<BuildItemCategory, string>>;
  lastFindings: Array<{ ruleId: string; status: string; conclusion: string }>;
};
~~~

模型只接收最近两轮原文和一份压缩的结构化摘要；完整历史保留在事件日志，不重复塞进 prompt。用户已明确的预算、用途和已有硬件由服务端优先级覆盖模型输出。

### 4.2 召回上下文

新增 RetrievedCandidateContext，把模型可见内容限定为以下字段：

~~~ts
type RetrievedCandidateContext = {
  canonicalId: string;
  category: BuildItemCategory;
  name: string;
  aliases: string[];
  decisionSpecs: Record<string, string | number | boolean | null>;
  qualityStatus: "verified" | "supported";
  missingFields: string[];
  price: { cents: number; capturedAt: string; evidenceIds: string[] } | null;
  evidenceSourceIds: string[];
  hardConstraintPassed: boolean;
  retrievalReasons: string[];
  tradeoffTags: string[];
};
~~~

召回分四步执行：

1. 对用户输入、型号和别名做 Unicode、大小写、空格、连字符、中文数字和单位规范化；
2. 先按类别、已有硬件排除、插槽/板型/接口/长度/功耗等硬约束过滤；硬约束无法判断时保留候选但标记 unknown，不当作通过；
3. 按型号/别名精确命中、用途/外观词命中、预算/价格证据、字段完整度和证据新鲜度排序；每类保留前 6 条，再从不同性能档位补 2 条，避免 8 条全是同一档；
4. 为每个候选关联字段质量和价格证据，并记录落选原因。没有候选时返回最小澄清问题，不用“相似型号”凑数。

模型看到的是 decisionSpecs 的白名单字段，不看到数据库行、SQL、文件路径、原始网页或系统提示词。字段缺失必须显式保留为 null 或 missingFields。

### 4.3 LLM 三类调用

保留现有 OpenAI-compatible provider 和环境变量，统一通过 completeJson：

1. **Intent parser**：输入当前消息、最近两轮摘要和当前结构化意图；输出完整意图、一个追问或 null。服务端覆盖显式预算与已确认字段。
2. **Candidate selector**：输入每类候选上下文、当前方案和兼容摘要；输出候选 ID、reasonCodes（例如 use_case_fit、budget_fit、quiet_preference）和最多一句可展示理由。禁止输出规格、价格和兼容结论。
3. **Answer planner**：输入已通过规则和 Claim Ledger 的方案摘要；输出 AnswerDraft：摘要、下一步、最多一个澄清问题和 claim 引用 ID。它不能创建新 claim，也不能填写未提供的数字。

reasonCodes 是枚举，展示文字由服务端根据候选的 retrievalReasons 渲染，避免模型凭空写理由。Answer planner 失败时直接渲染系统模板，不阻断方案生成。

### 4.4 Grounding 与回退

- 选件输出必须通过候选 ID、类别、质量状态、重复类别和 schema 守卫；失败走同一候选集的规则排序。
- 回答中的每个型号、价格、规格、尺寸、接口和兼容结论必须映射到 catalog_fact、price_fact 或 rule_result claim；映射失败的段落降级为 unknown。
- LLM 调用阶梯：完整候选池 + thinking → 每类 4 条 + 关闭 thinking → 规则路径。超时不在同一策略上盲目重试。
- 每次调用记录 prompt 版本、模型、延迟、尝试次数、输入候选数、输出 schema 结果、fallback 原因和安全摘要；不记录 key、完整系统 prompt 或跨用户原文。

## 5. 代码落点

后续实现按以下边界拆分，避免覆盖当前 A/B 并行工作线：

### 5.1 A 线文件（允许修改）

- src/application/agent/conversation-context.ts：会话上下文压缩与最近轮次选择。
- src/application/agent/retrieval-context.ts：候选白名单映射、决策字段和召回原因。
- src/domain/catalog/search.ts：规范化型号/别名召回和多样性补召回纯函数；不改变规格字段语义。
- src/application/design/intent-llm.ts：intent/selection schema v2、reasonCodes、上下文 prompt。
- src/application/design/answer-llm.ts：AnswerDraft schema、回答规划调用和模板回退。
- src/application/agent/validator.ts：AnswerDraft claim 引用检查和未知降级。
- src/application/design/service.ts、src/application/agent/orchestrator.ts：串联上下文、召回和回答规划；保持现有规则检查与写库边界。
- src/contracts/agent.ts、src/contracts/agent-events.ts：新增结构化契约和 safe event 字段。
- tests/agent/**、tests/application/**、tests/domain/catalog/**：纯函数、schema、回退和集成测试。

### 5.2 明确不动

不修改 B 线列出的中文目录采集、展示名和 tests/catalog/** 文件；不改变 canonical_products 规格字段含义，不把中文翻译写入规格字段。写数据库前仍遵守 data/rigmate.db 备份纪律。

## 6. 分阶段交付

### P0：先修“模型看不懂上下文”

- 会话上下文契约和意图 prompt v2；
- 修订请求把当前意图、上一版选择原因、兼容摘要一并传入；
- 完成 schema、注入、预算覆盖和失败回退测试。

验收：同一会话连续提出“预算 2 万打游戏”→“要白色安静”→“我已有电源”，意图字段只增量变化，不丢失已确认字段；无 key 时原有规则路径测试不变。

### P1：先修“召回不够准”

- 规范化型号/别名召回；
- 硬约束过滤、每类 6+2 多样性候选；
- 决策字段白名单和证据/价格上下文；
- 记录 Recall@20、Precision@10、MRR、空结果准确率和约束违规率。

验收：固定评测集上的精确型号、别名、错别字、用途描述、无结果样本都有可解释命中或诚实空结果；候选池外 ID 永远不能进入方案。

### P2：让回答“像懂硬件的助手”

- AnswerDraft 结构化回答调用；
- claim 引用验证和模板回退；
- UI 事件增加“召回原因 / 未知字段 / 依据数量”，仍使用现有 SSE。

验收：用户看到的每个精确结论都可展开到来源或规则；模型生成跑题文本、伪造价格和把 unknown 改成通过时，回答被阻断或降级。

### P3：评测与上线门禁

- 增加多轮对话、检索和回答的离线样本；
- 增加 live eval 对比 thinking 开关、候选数量和 provider；
- 把 schema 通过率、fallback 率、P95、unsupported claim rate 和成本写入运行报告。

## 7. 验收标准

- npm run lint、npm run typecheck、npm test、npm run build 全部通过；
- npx tsx scripts/data-release-gate.ts 通过，且不改变目录质量门结果；
- 离线评测中精确规格、价格、接口和兼容性 unsupported claim rate 为 0；
- LLM 不可用时，创建、修订和接受方案仍能走规则路径；
- 任意候选池外型号、未经审核价格、缺失字段推断和冲突转通过都无法落库或展示；
- 事件日志能定位每次调用的上下文版本、召回候选、模型选择、验证结果和回退原因。

## 8. 需要用户评审的决策

1. 是否同意采用方案 A，先增强现有链路，不引入向量库和多 Agent；
2. 是否同意回答规划器只输出结构化 AnswerDraft，事实和具体数字继续由系统 claim 渲染；
3. 是否同意按 P0 → P1 → P2 → P3 分期，先交付“上下文 + 召回 + 可靠调用”，再做 UI 文案和 live eval。

评审通过后，再按阶段写 implementation plan 并开始改代码。
