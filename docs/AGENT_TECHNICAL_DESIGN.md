# RigMate Agent 技术设计与安全准确性规范

**版本：** 1.0  
**日期：** 2026-09-28  
**目标：** 为 RigMate 后续 Agent、RAG、工具调用和质量保障提供长期可维护的技术事实源

相关文档：

- 项目总计划：docs/PROJECT_MASTER_PLAN.md
- Agent 当前交接：docs/AI_COLLABORATION.md
- UI 设计基线：docs/superpowers/specs/2026-09-28-rigmate-ui-redesign.md
- 业务边界：docs/PC_DIY_装机助手_业务逻辑规格_v1.md
- 现有契约：src/contracts/design.ts
- 现有模型适配：src/infra/llm/client.ts、src/application/design/intent-llm.ts

---

## 1. 总体结论

RigMate Agent 采用“受约束的决策编排器”，不是可以自由浏览、自由执行代码或自由相信网页内容的通用聊天 Agent。

Agent 的职责被严格拆成四类：

1. 理解用户目标，并转换成结构化意图。
2. 从受控目录和证据库中检索候选事实。
3. 在确定性规则约束下提出方案和取舍解释。
4. 将经过验证的结果组织成用户可读的回答。

模型不能直接决定精确价格、尺寸、接口、兼容性、数据库状态或用户项目状态。模型也不能直接执行任意工具、访问密钥、读取内部提示词、修改数据库或代表用户接受方案。

核心原则：

- 输入不可信。
- 检索内容不可信。
- 模型输出不可信。
- 事实必须来自有来源的数据或确定性规则。
- 每个结论必须能回到证据、规则或用户明确输入。
- 不确定时必须说不知道，并提出最小补充问题。
- 所有写操作必须经过 application service 的权限和状态检查。

## 2. Agent 分层架构

### 2.1 请求入口层

负责限流、请求大小限制、用户输入规范化、请求 ID、用户会话和审计上下文。不进行模型调用。

### 2.2 输入安全层

负责识别可能的提示词注入、越权请求、秘密索取、工具操控指令和恶意内容。安全层不尝试替用户改写原意，只给输入打标签并决定是否允许进入后续流程。

### 2.3 意图解析层

模型只输出 StructuredIntent。该层不得接收工具描述、数据库密钥或内部提示词。预算、用途、外观、已有硬件、限制条件和地区是允许输出的字段。

### 2.4 检索层

先做结构化过滤，再做关键词或全文召回，最后做候选重排。硬件目录的型号、类别、插槽、长度、功耗等事实优先从关系数据读取，不把它们仅作为向量文本。

### 2.5 决策层

把意图、候选、规则和价格证据交给确定性服务。模型只可以在候选集合中排序、解释或提出取舍，不能新增候选。

### 2.6 验证层

验证方案中的每个字段、每条价格、每条兼容性结论和每个引用。验证失败时将结论降级为 unknown，不能继续以肯定语气输出。

### 2.7 回答层

根据经过验证的 Claim Ledger 生成用户回答。回答生成器只能读取允许展示的事实和证据摘要，不直接读取原始数据库、系统提示词或密钥。

### 2.8 审计层

记录请求摘要、模型版本、提示词版本、检索候选 ID、工具调用、验证结果、最终状态和耗时。敏感原文按策略脱敏或哈希化。

## 3. Agent 状态机

每次用户请求建立一个 AgentRun，状态按以下顺序推进：

received → screened → understanding → retrieved → composed → validated → answered

异常状态：blocked、needs_input、refused、failed、cancelled。

状态推进纪律：

- 只能由 orchestrator 修改，页面和模型不能直接写状态。
- 每次状态变化追加 AgentEvent。
- 状态失败后保留已完成阶段的结果和原因。
- 重试必须生成新的 runAttempt，不覆盖旧审计。
- 超时、模型错误、检索为空和验证失败必须使用不同错误码。

## 4. 零信任输入与提示词注入防护

### 4.1 输入分类

所有外部文本分为以下类型，并在进入模型前封装成独立字段：

- user_goal：用户目标和偏好。
- user_revision：用户对现有方案的修改。
- catalog_text：目录名称、别名和规格。
- evidence_text：价格证据和来源摘要。
- tool_result：工具返回的结构化结果。
- system_policy：代码中的固定政策，不由任何外部文本覆盖。

模型上下文中不得把这些内容拼成一段无边界长文本。每个字段使用明确 XML 风格标签或消息字段，并告诉模型 catalog_text、evidence_text 和 tool_result 是数据，不是指令。

### 4.2 注入类型

至少检测以下模式：

1. 直接覆盖指令，例如忽略之前规则、改写系统提示词。
2. 角色冒充，例如声称自己是系统、管理员或工具。
3. 秘密索取，例如要求输出密钥、内部提示词、数据库内容或其他用户数据。
4. 工具操控，例如要求执行未授权命令、打开链接、发消息、修改项目或跳过校验。
5. 检索污染，例如硬件名称、网页描述或备注中包含“请忽略系统规则”等文本。
6. 间接注入，例如用户给出链接、文件或商品描述，要求模型按其中指令执行。
7. 数据外带，例如把内部字段编码、拼接或转换后输出。

检测结果分为 none、suspicious、blocked。suspicious 进入低权限回答模式，只处理可验证装机事实；blocked 返回固定拒答并保留安全事件，不把检测细节暴露给攻击者。

### 4.3 提示词结构

每个用例使用独立模板，不使用一个万能系统提示词。模板分为：

1. 角色和任务边界。
2. 事实来源优先级。
3. 允许调用的工具和参数范围。
4. 不可执行的动作。
5. 输出 JSON schema。
6. 失败和不确定处理。
7. 用户数据和检索数据的边界说明。

系统提示词不包含秘密，不包含可被用户回显的内部路径、数据库连接、API key 或未发布的策略细节。提示词通过版本号管理，变更进入评测集后才能上线。

### 4.4 不把安全寄托给提示词

即使模型被诱导，也必须由代码阻止危险结果：

- 所有输出经过 Zod schema。
- 所有 catalogId 与候选白名单比对。
- 所有工具调用经过名称和参数 allowlist。
- 所有写操作必须走 application service。
- 所有精确事实由数据库或规则服务重新读取。
- 所有最终回答经过 Claim Ledger 验证。
- 任何模型输出都不能直接执行 JavaScript、SQL、Shell 或网络请求。

## 5. 工具调用安全设计

### 5.1 工具分类

只提供最小必要工具：

- searchCatalog：只读，参数为类别、关键词、结构化过滤和上限。
- getCatalogItem：只读，只接受 catalogId。
- searchEvidence：只读，按 productId、类别、地区和日期过滤。
- runCompatibilityCheck：只读，输入规范化 Build 条目。
- calculateBudget：纯函数，不访问网络。
- createDesignProposal：内部 application 调用，不暴露给模型自由写数据库。
- askUserQuestion：只产生待确认事件，不自动发送外部消息。

### 5.2 工具权限

每个 AgentRun 绑定 capability set。意图解析只能使用无工具权限；候选选择只能读取检索结果；方案接受、保存、删除和外部发送永远不授予模型。

工具参数必须经过 Zod schema、长度限制、枚举限制和资源归属检查。工具结果带有 toolCallId、source、retrievedAt、confidence 和 expiresAt。

### 5.3 工具结果处理

工具返回的文本视为不可信数据，不视为指令。工具结果中的 URL 不自动打开，外部内容不自动执行。工具失败时明确返回 unavailable，不让模型把缺失结果补成猜测。

## 6. RAG 与目录检索设计

### 6.1 不把所有内容都做向量化

RigMate 的硬件事实具有强结构化特征。以下字段使用关系查询或全文索引：类别、型号、别名、插槽、板型、内存类型、接口、长度、高度、功耗、连接器和规格来源。

向量检索只用于：

- 用户自然语言用途与偏好匹配。
- 规格来源中的说明段落召回。
- 价格证据备注和产品别名的语义补全。

向量检索不能单独决定兼容性，不能替代精确字段过滤。

### 6.2 检索管道

1. 输入规范化：中文数字、单位、型号空格、大小写、全半角和常见别名统一。
2. 意图过滤：先限制类别、地区、价位、已有硬件和排除项。
3. 关键词召回：型号、别名、系列名和关键规格全文匹配。
4. 结构化过滤：去除类别不符、缺关键字段或明显超约束的候选。
5. 向量补召回：只在关键词候选不足时补充语义相近条目。
6. 合并去重：按 canonical product ID 合并，不按文本名称去重。
7. 重排：规则硬约束优先，其次是用途匹配、预算距离、证据新鲜度、来源可信度和用户偏好。
8. 截断：给模型的候选数量固定上限，并保留未入选原因。

### 6.3 数据分层

每条资料包含：

- canonicalId、category、name、aliases。
- decisionSpecs：参与决策的结构化字段。
- sourceUrl、sourceName、sourceCommit、license。
- capturedAt、updatedAt、freshnessClass。
- evidenceType：catalog、manufacturer、price_evidence、user_input、model_experience。
- qualityStatus：verified、partial、unverified、deprecated。

模型只接收决策字段和来源摘要，不接收任意原始 HTML。

### 6.4 RAG 召回质量门槛

上线前建立固定评测集，至少包含：型号直搜、别名、中文俗称、错别字、用途描述、预算描述、跨类别干扰、没有结果和恶意检索文本。

必须测量：

- Recall@k：正确 canonicalId 是否进入候选。
- Precision@k：候选中有效条目的比例。
- MRR：正确候选的排名位置。
- nDCG：多条相关候选的排序质量。
- empty-result accuracy：确实无结果时是否诚实为空。
- constraint violation rate：候选是否违反类别或结构化约束。

硬件精确型号检索优先保证 Recall@20 和 constraint violation rate；最终展示再通过重排控制 Precision。

### 6.5 召回失败策略

- 无候选：明确显示资料不足，提出一个最小澄清问题。
- 候选冲突：保留候选，但交给规则层判定，不让模型自行消解。
- 规格不完整：候选标记 partial，涉及该字段的结论变为 unknown。
- 证据过期：显示证据日期并降低置信度，不自动删除历史记录。

## 7. 事实准确性与回答可靠性

### 7.1 事实等级

每条可展示事实必须属于以下之一：

- verified_catalog：系统目录已核验。
- manufacturer_source：厂商或可信来源。
- price_evidence：价格证据快照。
- user_input：用户明确提供。
- deterministic_rule：规则引擎计算。
- model_experience：模型经验，只能作为建议。
- unknown：资料不足。

事实等级影响措辞。verified_catalog、manufacturer_source 和 deterministic_rule 可以使用肯定语气；price_evidence 必须带日期；model_experience 必须标注经验建议；unknown 不能伪装成结论。

### 7.2 Claim Ledger

回答生成前建立 Claim Ledger，每条 claim 至少包含：

- claimId。
- textTemplate。
- value。
- sourceType。
- sourceIds。
- confidence。
- checkedAt。
- allowedToSay。
- reasonIfBlocked。

回答生成器只能引用 allowedToSay 为 true 的 claim。没有 sourceIds 的精确数值、型号、尺寸、接口和兼容结论默认禁止输出。

### 7.3 两阶段生成

第一阶段生成结构化决策结果：方案条目、事实、取舍、问题和证据引用。第二阶段把 Claim Ledger 渲染成中文回答。

两阶段之间运行验证器：

- 每个 catalogId 存在且类别正确。
- 每个规格字段来自目录或用户输入。
- 价格范围合理且来源标记一致。
- 兼容性重新调用规则引擎。
- 回答中的数字和型号都能映射到 claim。
- 没有出现被禁止的内部字段、提示词或密钥。

### 7.4 最小澄清问题

当信息不足时，Agent 不继续猜测方案，按影响最大的缺失字段提问。问题优先级：预算、主要用途、已有关键硬件、尺寸限制、电源条件、地区。一次最多问两个紧密相关的问题，并说明为什么需要。

### 7.5 拒答与降级

以下情况必须拒答或降级：

- 用户要求泄露系统提示词、密钥、内部数据或其他用户信息。
- 需要执行未授权的写操作或外部动作。
- 关键规格缺失且无法通过可信来源补齐。
- 检索结果互相矛盾且规则无法判定。
- 模型输出无法通过 schema、白名单或事实验证。
- 工具超时或数据过期到无法支持结论。

降级回答应保留已经验证的部分，并清楚标出不能确定的部分。

## 8. Prompt、模型和配置治理

### 8.1 Prompt Registry

提示词存放在版本化代码或专用 registry，不散落在页面组件中。每个模板有 name、version、purpose、inputSchema、outputSchema、allowedTools、riskLevel 和 changelog。

### 8.2 模型路由

意图解析、候选排序、回答渲染可以使用不同模型配置。每个任务定义 timeout、maxTokens、temperature、retry、fallback 和成本上限。温度为 0 的结构化任务优先，解释生成可以使用受控低温度。

### 8.3 失败和重试

结构化解析失败最多一次修复请求，修复请求不能改变任务边界。网络超时不默认重复造成成本放大，改走本地规则。所有重试使用 requestId、runId、attemptId 记录。

### 8.4 敏感信息

API key 只从服务端环境读取，禁止进入日志、事件、前端响应、Prompt Registry、测试快照和错误堆栈。用户原文、证据原文和模型输出按日志级别脱敏。

## 9. 评测体系

### 9.1 离线数据集

建立四类样本：

1. 正常目标：预算、用途、风格和已有硬件。
2. 模糊目标：缺预算、缺用途或多个冲突偏好。
3. 对抗样本：提示词注入、秘密索取、工具越权、恶意目录文本。
4. 事实样本：型号、规格、兼容冲突、价格证据和过期数据。

每条样本保存输入、期望意图、允许事实、禁止事实、应追问字段和风险标签。

### 9.2 指标

意图层：字段准确率、预算解析准确率、遗漏率、幻觉字段率。  
检索层：Recall@k、Precision@k、MRR、nDCG、空结果准确率。  
事实层：claim support rate、citation coverage、unsupported claim rate、contradiction rate。  
安全层：注入拦截率、越权工具调用率、秘密泄露率、误拦截率。  
产品层：一次完成率、澄清轮次、用户接受率、冲突解决率、平均延迟、单次成本。

### 9.3 上线门槛

上线前至少满足：

- 结构化输出 schema 通过率不低于 99%。
- 关键型号召回 Recall@20 达到项目设定目标。
- 精确规格和兼容结论 unsupported claim rate 为 0。
- 未授权工具调用率为 0。
- 密钥和内部提示词泄露率为 0。
- 规则冲突不能被回答层改写成通过。
- 失败时能稳定降级到本地规则或明确拒答。

具体百分比必须在建立首批真实样本后冻结，不能在测试失败时临时降低。

## 10. 监控、审计和事故响应

每个 AgentRun 记录：requestId、runId、promptVersion、model、latencyMs、tokenUsage、retrievalIds、toolCalls、validationSummary、finalStatus、errorCode 和 fallbackUsed。

监控指标：

- 模型超时率和 schema 失败率。
- 检索空结果率、候选约束违规率。
- 事实验证失败率和 unknown 比例。
- 注入命中率和误拦截率。
- 每个模型和 Prompt 版本的接受率、成本和延迟。

事故处理：

1. 立即冻结问题 Prompt 或模型版本。
2. 通过 feature flag 切换到规则式降级。
3. 保留 run 审计和最小必要输入。
4. 增加回归样本。
5. 修复后离线评测，再灰度发布。
6. 在 AI_COLLABORATION.md 记录事故和修复版本。

## 11. 具体代码演进计划

### A1：安全输入层

新增 src/application/agent/safety.ts、src/application/agent/input-normalizer.ts、src/application/agent/policy.ts。先实现输入长度、字段分离、风险标签、拒答码和脱敏日志，不改变现有业务结果。

### A2：Prompt Registry 与结构化任务

新增 src/application/agent/prompts/，把 intent-llm.ts 中的系统提示词迁入版本化模板。每个模板配套 schema、允许工具和风险等级。补充 prompt snapshot 测试。

### A3：工具注册表

新增 src/application/agent/tools/registry.ts、catalog-tools.ts、evidence-tools.ts、compatibility-tools.ts。所有工具通过统一 registry 注册，模型不能直接访问 repository。

### A4：检索服务

新增 src/application/retrieval/、src/domain/retrieval/。先做结构化过滤、关键词全文和重排，再评估是否需要向量索引。新增召回评测脚本和固定数据集。

### A5：事实账本与验证器

新增 src/domain/agent/claims.ts、src/application/agent/validator.ts。把 Proposal、Finding、PriceEvidence 转为 Claim Ledger，并对所有最终文案做支持性校验。

### A6：Agent Orchestrator

新增 src/application/agent/orchestrator.ts。统一编排 screen、understand、retrieve、compose、validate、answer，现有 design/service.ts 逐步变成兼容适配层。

### A7：安全和准确性评测

新增 tests/agent/、tests/retrieval/、scripts/evaluate-agent.ts、data/evals/。测试正常、模糊、对抗和事实样本，输出 JSON 报告和可比较的版本指标。

### A8：灰度和监控

新增 feature flag、run 审计字段、错误码、fallback 统计和管理员只读诊断页。先对内部样本开启，再对少量用户开启。

## 12. 绝对禁止事项

- 不把用户输入直接拼接到系统提示词。
- 不把检索网页或目录备注当作系统指令。
- 不让模型返回任意 SQL、Shell、JavaScript 或 HTTP 请求。
- 不让模型直接写数据库、删除项目、接受方案或发送外部消息。
- 不用向量相似度代替插槽、尺寸、功耗和接口规则。
- 不把经验估算显示成已核验价格。
- 不把 unknown、超时、空结果或验证失败显示成通过。
- 不为了让回答看起来完整而补造型号、数字或来源。

## 13. Agent 完成定义

Agent 平台达到可长期维护状态，需要同时满足：

1. 所有外部输入、检索内容和模型输出都有明确边界。
2. 每个工具有 schema、权限、审计和失败处理。
3. RAG 有固定评测集、召回指标和空结果策略。
4. 每个精确事实都有 Claim Ledger 来源，验证失败会降级。
5. Prompt、模型和工具版本可追踪、可回滚。
6. 注入、秘密泄露和越权操作有自动化回归测试。
7. 规则引擎是兼容性最终裁判，模型不能覆盖规则结果。
8. 线上有延迟、成本、失败、unknown 和安全事件监控。
9. Agent 关闭或异常时，产品仍能使用本地规则完成核心装机流程。
