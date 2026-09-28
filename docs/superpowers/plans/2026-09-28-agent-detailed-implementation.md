# RigMate Agent 详细实现计划

目标：把 Agent 技术设计落成可测试、可审计、可回滚的模块化运行时。

前置文档：docs/agent/README.md、docs/agent/01-threat-model.md、docs/agent/02-runtime-and-state-machine.md、docs/agent/03-prompt-tool-contracts.md、docs/agent/04-rag-grounding-and-claims.md、docs/agent/05-evaluation-and-operations.md。

## Task 1：建立 Agent 契约和错误码

文件：src/contracts/agent.ts、src/domain/agent/errors.ts、tests/agent/contracts.test.ts。

- [ ] 定义 RiskLevel、AgentStage、AgentRunStatus、FallbackLevel、ToolCallStatus、ClaimKind。
- [ ] 定义 RequestContext、AgentEvent、ToolCall、Claim、ClaimLedger、AnswerViewModel 的 Zod schema。
- [ ] 定义 INPUT_TOO_LARGE、PROMPT_INJECTION_BLOCKED、MODEL_TIMEOUT、SCHEMA_INVALID、RETRIEVAL_EMPTY、GROUNDING_FAILED、RESOURCE_FORBIDDEN 等错误码。
- [ ] 测试非法枚举、超长字段、缺失 sourceIds 和跨用户 scope。

## Task 2：实现输入安全层

文件：src/application/agent/input-normalizer.ts、src/application/agent/safety.ts、src/application/agent/policy.ts、tests/agent/security/。

- [ ] 实现 Unicode、空白、单位、中文数字和型号规范化。
- [ ] 实现字段长度、请求大小、嵌套深度和单用户速率限制。
- [ ] 实现 none、suspicious、blocked 风险分类。
- [ ] 为每种风险分配 capability set。
- [ ] 对用户目标、目录文本、证据文本和工具结果使用不同输入类型。
- [ ] 加入 130 条安全回归样本。

## Task 3：实现 Prompt Registry

文件：src/application/agent/prompts/registry.ts、intent-extract-v1.ts、intent-revise-v1.ts、catalog-select-v1.ts、answer-render-v1.ts、tests/agent/prompts.test.ts。

- [ ] 每个模板包含版本、输入输出 schema、风险等级、允许工具、超时和 fallback。
- [ ] 将现有 intent-llm.ts 中的系统提示词迁移进 registry。
- [ ] 明确 DATA 字段边界，禁止用户和检索文本覆盖系统政策。
- [ ] 加入稳定 Prompt snapshot。
- [ ] 为结构化失败实现最多一次格式修复，失败转 fallback。

## Task 4：实现 Tool Registry 和 Tool Executor

文件：src/application/agent/tools/registry.ts、tool-executor.ts、catalog-tools.ts、evidence-tools.ts、compatibility-tools.ts、tests/agent/tools/。

- [ ] 实现工具名称、输入输出 schema、capability、readonly、maxCalls、timeoutMs 和资源范围。
- [ ] 只注册 searchCatalog、getCatalogItem、searchEvidence、runCompatibilityCheck、calculateBudget。
- [ ] 模型不得直接拿到 repository、SQL、Shell、任意 URL 或写操作。
- [ ] 工具结果附带 source、retrievedAt、qualityStatus 和 expiresAt。
- [ ] 测试非法 ID、错误类别、超范围参数、调用超限和超时。

## Task 5：实现混合检索服务

文件：src/domain/retrieval/types.ts、rank.ts、src/application/retrieval/service.ts、tests/retrieval/、data/evals/retrieval/、scripts/evaluate-retrieval.ts。

- [ ] 先做类别、地区、预算和结构化规格过滤。
- [ ] 实现名称、别名、系列和型号全文召回。
- [ ] 候选不足时再补语义召回，向量结果不能绕过硬约束。
- [ ] 按硬约束、用途匹配、预算距离、证据质量和新鲜度重排。
- [ ] 输出 canonicalId、sourceIds、qualityStatus、retrievalReasons 和分项分数。
- [ ] 评测 Recall@20、Precision@10、MRR、nDCG、空结果准确率和约束违规率。

## Task 6：实现 Claim Ledger 和事实验证器

文件：src/domain/agent/claims.ts、src/application/agent/validator.ts、tests/agent/grounding/。

- [ ] 定义 catalog_fact、price_fact、user_fact、rule_result、experience_advice、unknown、question。
- [ ] 为每条 claim 保存 sourceIds、confidence、checkedAt、allowedToSay 和 blockedReason。
- [ ] 验证 catalogId、规格、价格来源、规则版本和回答数字。
- [ ] 拦截没有 claim 支持的精确型号、尺寸、接口和兼容结论。
- [ ] 验证失败时输出 unknown、needs_input 或 grounding error。

## Task 7：实现 Agent Orchestrator

文件：src/application/agent/orchestrator.ts、context.ts、task-runner.ts、fallback.ts、src/contracts/agent.ts、tests/application/agent-orchestrator.test.ts。

- [ ] 实现 received、screened、understanding、retrieved、composed、validated、answered 状态。
- [ ] 实现 blocked、needs_input、failed、cancelled 终态。
- [ ] 共享 deadline，限制工具次数、token 预算和总运行时间。
- [ ] 实现 L0 受约束模型、L1 模型意图加规则、L2 本地规则、L3 只读结果、L4 拒答。
- [ ] 每次转换追加安全的 AgentEvent，原始输出进入受限审计。
- [ ] 将现有 design/service.ts 改为 orchestrator adapter，保持 API 响应兼容。

## Task 8：建立评测和发布门禁

文件：data/evals/agent/、scripts/evaluate-agent.ts、tests/agent/adversarial.test.ts、tests/agent/grounding.test.ts、tests/agent/regression.test.ts。

- [ ] 建立正常、模糊、冲突、无结果、过期、注入、秘密索取和工具越权样本。
- [ ] 计算意图、检索、事实、安全和运行指标。
- [ ] 固定精确事实 unsupported claim rate 为 0，秘密泄露和未授权工具调用为 0。
- [ ] 模型、Prompt、检索排序或回答模板变更必须通过评测才能合并。

## Task 9：审计、监控和灰度

文件：src/infra/db/migrate.ts、src/infra/db/repositories/agent-audit-repository.ts、src/application/agent/telemetry.ts、src/application/agent/audit.ts、docs/AGENT_OPERATIONS.md。

- [ ] 增加 promptVersion、model、attempt、latency、tokenUsage、retrievalIds、toolCalls、fallback 和 errorCode 审计字段。
- [ ] 实现日志脱敏，禁止 API key、完整 system prompt 和跨用户数据入日志。
- [ ] 增加延迟、成本、失败、unknown、空结果、验证失败和安全事件指标。
- [ ] 使用 feature flag 灰度 Prompt、模型、检索和完整 Agent。
- [ ] 编写规则式 fallback 和事故回滚操作手册。

## Task 10：端到端验收

- [ ] 运行 npm run typecheck。
- [ ] 运行 npm run lint。
- [ ] 运行 npm test。
- [ ] 运行 npm run test:e2e。
- [ ] 运行 npm run build。
- [ ] 关闭模型配置，验证本地规则仍可生成和检查方案。
- [ ] 使用攻击样本验证提示词、密钥、工具和跨用户隔离。
- [ ] 使用真实脱敏样本验证召回、事实绑定和 unknown 策略。
- [ ] 记录 Prompt、模型、目录和规则版本，生成第一份 Agent 发布报告。

完成条件：Agent 可以在不依赖模型的情况下完成基本装机流程；模型只能在受控边界内理解、选择和解释；所有精确事实可追溯；安全和准确性指标可自动回归；版本可以灰度和回滚。
