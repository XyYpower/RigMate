# RigMate Agent 平台实施计划

目标：在保留当前规则式装机主链路的前提下，逐步建设具备提示词注入防护、受控工具调用、可评测 RAG、事实验证和可回滚能力的 Agent 平台。

架构：先建立安全边界和评测基线，再建立检索与 Claim Ledger，最后将现有 design service 收敛到统一 orchestrator。任何新模型能力都必须先经过结构化 schema、候选白名单和确定性规则验证。

## 阶段 1：安全边界

文件：src/application/agent/safety.ts、src/application/agent/input-normalizer.ts、src/application/agent/policy.ts、tests/agent/safety.test.ts。

- [ ] 定义输入类型、风险等级、拒答码和脱敏策略。
- [ ] 实现长度、字符、嵌套字段和请求频率限制。
- [ ] 识别直接覆盖指令、秘密索取、工具越权和数据外带模式。
- [ ] 将 user_goal、catalog_text、evidence_text 和 tool_result 分离传给模型。
- [ ] 覆盖正常中文目标、恶意目标、恶意目录名称和间接注入样本。
- [ ] 验证安全层不改变正常意图解析结果。

## 阶段 2：Prompt Registry

文件：src/application/agent/prompts/index.ts、src/application/agent/prompts/intent-v1.ts、src/application/agent/prompts/selection-v1.ts、src/application/agent/prompts/answer-v1.ts、tests/agent/prompts.test.ts。

- [ ] 为每个任务定义版本、输入 schema、输出 schema、允许工具、风险等级和回退策略。
- [ ] 把现有 intent-llm.ts 中的提示词迁移到 registry。
- [ ] 给每个 prompt 生成稳定快照，变更必须更新评测报告。
- [ ] 删除页面或业务函数中的散落提示词。

## 阶段 3：工具注册与权限

文件：src/application/agent/tools/registry.ts、catalog-tools.ts、evidence-tools.ts、compatibility-tools.ts、tests/agent/tools.test.ts。

- [ ] 定义工具名称、输入输出 schema、只读/写入权限、超时和最大返回条数。
- [ ] 只注册目录、证据、预算和兼容检查工具。
- [ ] 禁止模型直接调用 repository、SQL、Shell、任意 URL 或外部消息接口。
- [ ] 工具结果携带来源、时间、置信度和过期信息。
- [ ] 测试非法 catalogId、跨类别调用、超范围参数和超时。

## 阶段 4：混合检索与评测

文件：src/domain/retrieval/types.ts、src/domain/retrieval/rank.ts、src/application/retrieval/service.ts、tests/retrieval/rank.test.ts、data/evals/retrieval.json、scripts/evaluate-retrieval.ts。

- [ ] 先做类别、地区、预算和规格结构化过滤。
- [ ] 增加名称、别名、系列和规格关键词检索。
- [ ] 只有候选不足时才启用语义补召回。
- [ ] 按约束满足、用途匹配、预算距离、来源可信度和新鲜度重排。
- [ ] 使用 Recall@20、Precision@10、MRR、nDCG、空结果准确率和约束违规率评测。
- [ ] 固定一批型号直搜、别名、错别字、用途描述、无结果和恶意文本样本。

## 阶段 5：Claim Ledger 与事实验证

文件：src/domain/agent/claims.ts、src/application/agent/validator.ts、tests/agent/claims.test.ts、tests/agent/validator.test.ts。

- [ ] 为型号、规格、价格、兼容结论、经验建议和未知项定义 claim 类型。
- [ ] 每个 claim 记录 sourceType、sourceIds、checkedAt、confidence 和 allowedToSay。
- [ ] 重新校验 catalogId、类别、规格字段、价格来源和规则结果。
- [ ] 检测回答中出现但不存在于 claim ledger 的数字、型号、尺寸和接口。
- [ ] 验证失败时将 claim 降级为 unknown 或阻止输出。

## 阶段 6：统一 Agent Orchestrator

文件：src/application/agent/orchestrator.ts、src/application/agent/run-state.ts、src/contracts/agent.ts、tests/application/agent-orchestrator.test.ts。

- [ ] 定义 received、screened、understanding、retrieved、composed、validated、answered、blocked、needs_input、failed 状态。
- [ ] 每次状态切换追加 AgentEvent，保存 promptVersion、model、attempt 和 fallback 信息。
- [ ] 将现有 design/service.ts 的意图解析、候选选择、规则检查接入 orchestrator。
- [ ] 模型失败时回退本地规则，检索为空时进入 needs_input，验证失败时禁止 ready。
- [ ] 保持 POST /api/design、修订和接受 API 的返回兼容。

## 阶段 7：安全与准确性评测门禁

文件：data/evals/agent.json、scripts/evaluate-agent.ts、tests/agent/adversarial.test.ts、tests/agent/grounding.test.ts。

- [ ] 建立正常目标、模糊目标、注入、秘密索取、工具越权、规格冲突和过期价格样本。
- [ ] 测量字段准确率、预算准确率、幻觉字段率、claim support rate、citation coverage、unsupported claim rate、注入拦截率和秘密泄露率。
- [ ] 任何精确规格或兼容结论的 unsupported claim rate 必须为 0。
- [ ] 任何未授权工具调用和秘密泄露必须为 0。
- [ ] 模型、提示词或检索排序改动未通过评测时禁止进入生产。

## 阶段 8：审计、监控与灰度

文件：src/infra/db/migrate.ts、src/infra/db/repositories/agent-audit-repository.ts、src/application/agent/telemetry.ts、tests/infra/agent-audit.test.ts、docs/AGENT_OPERATIONS.md。

- [ ] 增加 agent_runs 的 promptVersion、model、attempt、latency、tokenUsage、fallback 和 errorCode 审计字段。
- [ ] 敏感数据脱敏，API key 永不入库或日志。
- [ ] 统计超时率、schema 失败率、检索空结果率、验证失败率、unknown 比例、成本和延迟。
- [ ] 增加规则式 fallback feature flag。
- [ ] 先内部样本灰度，再小范围用户灰度，最后扩大范围。
- [ ] 记录回滚步骤和事故响应流程。

## 阶段 9：生产前最终验收

- [ ] npm run typecheck
- [ ] npm run lint
- [ ] npm test
- [ ] npm run test:e2e
- [ ] npm run build
- [ ] 运行完整 Agent 离线评测。
- [ ] 检查没有直接拼接系统提示词和用户输入。
- [ ] 检查所有工具通过 registry 和 schema。
- [ ] 检查所有精确结论都有 Claim Ledger 来源。
- [ ] 检查模型关闭时本地规则流程仍可生成和检查方案。

完成后再考虑 OCR、异步 worker、向量数据库、多用户云端和 PostgreSQL。它们不是 Agent 准确性和安全性的替代品。
