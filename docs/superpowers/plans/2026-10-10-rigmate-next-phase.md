# RigMate 下一阶段：运行时收口、真实模型增益与生产候选池

依据：docs/superpowers/plans/2026-10-09-rigmate-product-core-and-agent-runtime-v2.md

当前状态：产品内核和薄 Agent Runtime 已完成第一版，但真实模型还未参与评测，生产库候选池仍严重不足。本计划先修正完成声明和运行时边界，再推进真实模型与多方案方向。

## 0. 当前验收结论

已验证：

- 300 条单测通过；
- 9/9 固定设计评测通过；
- fixture 数据门禁通过；
- typecheck 通过；
- Pi 评估完成，决定自研薄 Runtime，不引入 Pi 依赖；
- 质量门、价格证据、字段质量回溯、Claim Ledger 和基础 orchestrator 已落地。

尚未完成：

- lint 有 rationaleByCategory 未使用 warning；
- 真实 gate:data 因开发库仍为 schema v10、代码为 v11 而失败；
- 生产库 26,204 条目录中只有 2 条 verified，11 条 missing_field 队列仍 open；
- 当前 9/9 评测使用脚本化模型输出，没有真实 LLM 增益证据；
- createAgentTools 已存在，但 orchestrator 仍由 service 直接提供检索和规则结果，三工具注册表尚未成为实际执行入口；
- 模型理由没有完整传入 proposal，当前 rationale 赋值后未被使用；
- measureSelectionGain 主要按价格差衡量，不能代表性能、噪音、扩展性或用途匹配增益；
- 多方案方向仍未实现。

## 1. Task A：先把当前分支收口到可发布状态

文件：src/application/design/service.ts、src/application/agent/orchestrator.ts、src/domain/design/proposal.ts、开发数据库、docs/AI_COLLABORATION.md。

- [ ] 修复 rationaleByCategory 未使用 warning，把模型理由明确传入 orchestrator 和 proposal；没有理由时使用领域层中性说明。
- [ ] 把真实开发库从 v10 升到 v11，重启 dev server 后重新运行 npm run gate:data。
- [ ] 不把 gate:data:fixture 的通过结果写成生产数据门禁通过；文档同时记录 fixture 与真实库结果。
- [ ] 对 .zcodeignore 等未跟踪文件做归属确认，未经确认不要纳入产品提交。
- [ ] 运行 typecheck、lint、test、gate:data、build，再决定是否合并当前分支。

## 2. Task B：让 Tool Registry 成为真实的 Runtime 边界

文件：src/application/agent/orchestrator.ts、src/application/agent/tools/*、src/application/design/service.ts、tests/application/agent-orchestrator.test.ts、tests/agent/adversarial.test.ts。

- [ ] 明确工具调用模型：工具由 Runtime 按阶段调用，模型只返回结构化选择，不开放自由工具循环。
- [ ] orchestrator 通过封闭 AgentToolRegistry 或等价 adapter 记录真实 toolCall，而不是只手写事件。
- [ ] searchCatalog 返回的候选必须与 service 生成的 CandidateSet 同源，不能出现两套排序逻辑。
- [ ] searchEvidence 只读字段状态和 source IDs；runCompatibilityCheck 只读运行瞬态条目，不写库。
- [ ] 测试工具调用前后数据库行数不变、非法参数被拒绝、工具失败进入 anomaly/fallback。
- [ ] 不引入 shell、文件、浏览器、任意 URL、发消息或写数据库工具。

## 3. Task C：真实模型选择评测

文件：src/application/design/intent-llm.ts、新增 scripts/run-live-selection-eval.ts、新增 tests/application/live-selection-contract.test.ts、data/evals/design-selection-cases.json、docs/design/product-core-recovery-review.md。

- [ ] 为模型选择器增加可注入的 ModelProvider/fetch adapter，线上 service、fixture 测试和 live eval 共用同一守卫。
- [ ] 默认评测继续离线、无网络、无密钥；真实模型评测必须显式使用 --live 和环境变量，不能进入普通 CI。
- [ ] 每个 live case 保存 promptVersion、候选集摘要哈希、模型输出、守卫结果、最终 ID、fallback 原因和延迟；不得保存 API key。
- [ ] 对同一 CandidateSet 比较模型选择、规则选择和人工期望，不能只比较价格。
- [ ] 非法 ID、编造字段、越权输出为 0；模型失败可回退；至少一部分正常目标在用途、预算或取舍评分上优于规则基线。
- [ ] 如果模型没有稳定增益，保留规则路径并记录模型暂不启用，不为了证明增益而修改评分口径。

## 4. Task D：把模型智力从单件选择提升到方案取舍

文件：src/contracts/design.ts、src/application/design/service.ts、src/domain/design/proposal.ts、新增评测与 application tests。

- [ ] 先实现单方案内的动态理由：理由必须引用 CandidateSet 的实际字段、价格状态和用户意图。
- [ ] 再定义最多 3 个方向：性能优先、安静/稳定优先、预算优先；每个方向使用同一 CandidateSet 和同一确定性规则检查。
- [ ] 每个方向必须有独立 proposal/version 或明确方向标识，不能覆盖历史结果。
- [ ] 方向排序由模型提出、系统验证；模型不能让冲突或 unknown 变成通过。
- [ ] 评测比较方向是否真正不同，以及差异是否能解释为用户目标取舍。
- [ ] UI 暂不扩展为复杂多卡片，先保持单方向默认展示和查看其他方向的数据接口。

## 5. Task E：生产候选池证据补齐

文件：scripts/verify-batch-*、审核 API、docs/2026-09-29-证据复核清单.md、docs/design/product-core-recovery-review.md。

- [ ] 目标不是把 26k 全部 verified，而是先建立八类可用的最小推荐池。
- [ ] 优先补 CPU、主板、内存、存储、电源、机箱中各至少 1 个 verified/supported 且关键字段可用于规则的产品。
- [ ] 优先处理已有 12 个人工证据产品的缺字段，不重复查已经有证据的字段。
- [ ] 所有新增事实继续走来源登记、字段证据、人工盖章、发布和 supersedes 链；不把认证等级推断成接口，不把聚合页面数值冒充官方事实。
- [ ] 每批完成后运行 catalog:quality、gate:data，记录可推荐类别数量和仍缺字段。
- [ ] 生产生成方案只有在推荐池达到最小覆盖后才恢复为可接受方案；此前保持候选不足的诚实追问。

## 6. Task F：模型上线策略

- [ ] 模型默认只做意图解析和候选排序，不直接开放完整 Agent 自主循环。
- [ ] 先在内部样本启用 selection-v1 feature flag，再比较模型路径、规则路径、fallback 率和用户可接受性。
- [ ] 任何 prompt、模型、排序权重或候选池变更都重新跑离线评测和 live eval。
- [ ] 模型超时、schema 失败、候选池为空、grounding 失败时稳定回退或追问。
- [ ] 不把模型已选择写成模型判断事实；事实仍由目录、证据和规则提供。

## 7. 暂不做

- 不继续扩展 UI 组件；
- 不引入 Pi 生产依赖；
- 不做开放式工具循环；
- 不做 RSC、Drizzle、Tailwind 或 DIY 大组件重构；
- 不做公网认证和多用户部署；
- 不把 26k partial 批量提升为 verified。

## 8. 下一阶段完成标准

1. 真实 gate:data 通过，schema 与开发库一致；
2. lint 无 warning；
3. Tool Registry 是真实 Runtime 的执行边界；
4. 真实模型在同一 CandidateSet 上完成可复现评测；
5. 模型相对规则基线有至少一个可解释的正向增益指标；
6. 八类至少有最小质量候选池，生产方案不再全量候选不足；
7. 多方向方案可以在后端生成并逐个通过相同规则与 grounding 验证；
8. UI 只在这些门槛通过后继续扩展。
