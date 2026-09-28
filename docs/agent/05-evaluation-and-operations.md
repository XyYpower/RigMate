# RigMate Agent 评测、上线和运维规范

## 1. 评测数据集

建立版本化 data/evals/agent/，每条样本包含 id、category、input、expectedIntent、allowedClaims、forbiddenClaims、expectedQuestions、riskTags、goldCatalogIds 和 expectedStatus。

样本类别：正常目标、模糊目标、冲突偏好、型号直搜、别名和错别字、无结果、兼容冲突、过期证据、直接注入、间接注入、秘密索取、工具越权和跨用户访问。

真实用户样本脱敏后才能进入评测集。原始个人信息和密钥永远不进入仓库。

## 2. 指标

意图：字段准确率、预算解析准确率、遗漏率、幻觉字段率。  
检索：Recall@20、Precision@10、MRR、nDCG、空结果准确率、约束违规率。  
事实：claim support rate、citation coverage、unsupported claim rate、contradiction rate。  
安全：注入拦截率、误拦截率、秘密泄露率、未授权工具调用率、跨用户访问率。  
运行：P50/P95 延迟、超时率、schema 失败率、fallback 率、token 成本、每次请求成本。  
产品：澄清轮次、用户接受率、冲突解决率、方案修改率和错误后恢复率。

## 3. 发布门禁

- 精确规格、尺寸、价格、接口和兼容性 unsupported claim rate 必须为 0。
- 秘密泄露、未授权工具调用和跨用户读取必须为 0。
- schema 通过率、关键型号召回率和空结果准确率不得低于项目冻结阈值。
- 新版本不得让规则冲突变成通过。
- 模型不可用时本地规则主链路仍可用。
- 所有高风险样本必须有可解释的拒答、降级或澄清结果。

具体阈值在首批真实样本完成后冻结，不能因测试失败临时降低。

## 4. 审计字段

AgentRun 审计至少包含 requestId、runId、attemptId、userScope、promptVersion、model、stage、latencyMs、tokenUsage、retrievalIds、toolCalls、validationSummary、fallbackUsed、errorCode、createdAt 和 completedAt。

审计日志与前端事件分离。前端只收到 safePayload，不收到密钥、完整系统提示词、跨用户数据和未经脱敏的模型原文。

## 5. 监控和告警

必须监控：模型超时率、模型错误率、schema 失败率、检索空结果率、候选约束违规率、验证失败率、unknown 比例、注入命中率、误拦截率、P95 延迟、单次成本和 fallback 率。

告警分级：

- P0：密钥或其他用户数据泄露、未授权写操作。
- P1：兼容冲突被显示为通过、关键事实无来源、跨用户读取。
- P2：模型错误、检索退化、成本或延迟超阈值。
- P3：单个类别召回下降、文案问题或非关键 UI 事件丢失。

## 6. 灰度和回滚

每个 Prompt、模型、重排器和检索版本使用独立 feature flag。灰度顺序：离线评测、开发环境、内部样本、少量真实用户、扩大流量。

回滚必须能独立切换：Prompt 版本、模型、候选选择器、回答渲染器和完整 Agent 到规则式 fallback。回滚不删除审计数据。

## 7. 事故处理

1. 冻结问题版本和相关 feature flag。
2. 切换 L2 本地规则或 L3 只读结果。
3. 保留 run、toolCall、claim 和验证日志。
4. 判断是输入注入、检索污染、模型错误、规则错误还是数据质量问题。
5. 增加回归样本和安全测试。
6. 修复后离线评测，进行小流量灰度。
7. 更新 AI_COLLABORATION.md 和变更日志。

## 8. 日常维护

每周检查异常 run、空结果类别、过期证据、成本、P95 延迟和 fallback 率。每次目录导入记录上游 commit、许可证、条数、错误和抽样核验。每次模型或 Prompt 变更重新运行安全、召回、事实和回归评测。

## 9. 运维代码落点

- src/application/agent/telemetry.ts：指标和耗时。
- src/application/agent/audit.ts：审计脱敏。
- src/infra/db/repositories/agent-audit-repository.ts：审计持久化。
- scripts/evaluate-agent.ts：离线评测。
- scripts/evaluate-retrieval.ts：检索评测。
- docs/AGENT_OPERATIONS.md：生产操作手册。
