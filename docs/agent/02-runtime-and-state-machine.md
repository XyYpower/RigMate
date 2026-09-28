# RigMate Agent Runtime 与状态机设计

## 1. Runtime 组成

Runtime 由六个模块组成：

1. RequestContext：请求 ID、用户范围、预算、超时和 capability。
2. Orchestrator：按状态机推进流程。
3. TaskRunner：执行单个结构化任务，负责 schema、超时和一次修复。
4. ToolExecutor：执行白名单工具并记录调用。
5. Validator：验证候选、事实、规则和最终回答。
6. EventSink：追加 AgentEvent 和审计事件。

页面只读取 AgentRun 投影，不直接控制 Runtime。

## 2. 生命周期

received：请求已校验并落审计。

screened：完成安全扫描和 capability 分配。

understanding：输出 StructuredIntent 或 needs_input。

retrieved：得到候选、证据和检索指标。

composed：生成结构化 ProposalDraft。

validated：通过 schema、候选白名单、规则和 Claim Ledger。

answered：生成面向用户的回答和 UI 数据。

失败状态：blocked、needs_input、failed、cancelled。每次失败必须保存 errorCode、stage、retryable 和 fallbackUsed。

## 3. 状态转换约束

- received 只能到 screened 或 failed。
- screened 只能到 understanding、blocked 或 failed。
- understanding 只能到 retrieved、needs_input 或 failed。
- retrieved 只能到 composed、needs_input 或 failed。
- composed 只能到 validated 或 failed。
- validated 只能到 answered、needs_input 或 failed。
- answered 是终态；修订创建新的 AgentRun，不复用旧 run。
- blocked、cancelled 和 failed 是本次 run 的终态，但项目可继续走新的 run。

## 4. 超时预算

默认单次运行 15 秒：安全扫描 500ms，意图解析 5 秒，检索 2 秒，候选选择 5 秒，规则验证 1 秒，回答渲染 2 秒。所有子任务共享 deadline，不能每个任务重新计时。

超时处理：

- 意图模型超时：本地解析。
- 候选模型超时：规则式候选。
- 价格证据超时：保留目录价格或 unknown。
- 回答模型超时：使用模板化事实摘要。
- 规则服务失败：不输出通过，返回 unknown 或重试提示。

## 5. 重试与幂等

每个 run 有 attemptId。结构化解析失败最多一次修复请求；网络超时默认不自动重试模型。工具读取可以在幂等条件下重试一次。接受方案、保存 Build、删除项目不由模型重试，必须由 API 幂等键保护。

幂等键由 userId、requestId、operation 和 clientRequestId 组成。重复请求返回已有结果，不重复写入。

## 6. 事件模型

每个事件包含：runId、attemptId、stage、type、status、message、safePayload、createdAt、durationMs、promptVersion、model、toolCallId 和 errorCode。

safePayload 只能包含 UI 所需的非敏感字段，例如候选数量、规则计数、回退原因分类。原始模型输出和敏感输入进入受限审计表，不直接返回前端。

## 7. 澄清策略

缺少关键字段时进入 needs_input，不生成半确定方案。问题生成器接收 missingFields 和用户已知字段，只能从问题模板中选一个或两个问题。回答必须包含：缺什么、为什么影响方案、用户可以怎样回答。

## 8. 降级层级

L0：受约束模型完整流程。

L1：模型意图解析 + 本地目录和规则。

L2：本地意图解析 + 本地目录和规则。

L3：仅展示已有方案和检查结果。

L4：安全拒答或服务错误。

降级不能改变事实等级。L1/L2 生成的理由必须标注规则式或经验估算。

## 9. Runtime 代码边界

- src/application/agent/orchestrator.ts：状态机和流程编排。
- src/application/agent/context.ts：RequestContext。
- src/application/agent/task-runner.ts：结构化模型任务。
- src/application/agent/tool-executor.ts：工具执行。
- src/application/agent/validator.ts：验证和 Claim Ledger。
- src/application/agent/fallback.ts：L0-L4 降级。
- src/contracts/agent.ts：跨层 schema。
- src/infra/db/repositories/agent-run-repository.ts：运行和事件落库。
