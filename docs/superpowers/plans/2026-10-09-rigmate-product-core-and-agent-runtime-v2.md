# RigMate 产品内核与 Agent Runtime 重制计划 v2

> Supersedes: docs/superpowers/plans/2026-10-09-rigmate-product-core-recovery.md
>
> Goal：让 RigMate 同时具备可信事实内核和真正有判断力的模型选件能力。规则固定事实与硬约束，模型动态理解目标、比较候选、进行取舍、提出问题和解释方案。

## 0. 当前工作区纪律

当前工作区存在另一个 AI 的未提交实现，涉及目录排序、价格上下文、评测脚本、迁移、UI 和测试。执行本计划前：

- [ ] 不重置、删除或覆盖这些未提交改动。
- [ ] 先运行 git diff --stat、git diff --check、npm run typecheck，把当前改动记录为基线。
- [ ] 逐文件审核其行为是否符合本计划；通过审核的实现可以保留，违反事实边界的实现必须修正。
- [ ] 本计划文档、Agent Runtime 和产品内核修复分开提交，不能把现有 UI 改动混进来。

## 1. 产品原则：固定事实，不固定选件

### 系统必须固定的内容

- 型号、类别、插槽、尺寸、接口、功耗、质量状态、价格证据和来源；
- 候选类别过滤、质量门、字段可用性和确定性兼容规则；
- unknown、conflicting、stale、unreviewed 的降级语义；
- 模型能力边界、工具权限、审计字段和回退路径。

### 模型可以动态判断的内容

- 从自然语言理解用途、预算弹性、外观、噪音、扩展性和已有硬件；
- 在当前检索候选中进行排序和组合；
- 比较性能优先、安静优先、预算优先等不同方案；
- 解释取舍并提出最小澄清问题；
- 根据最新目录、价格证据和用户修订重新选件；
- 在候选不足时拒绝硬凑，并说明缺口。

模型不能创造事实，但这不等于固定八个型号。产品的时效性来自动态目录、证据和价格上下文，模型负责在当前候选空间中做软目标优化。

## 2. 总体架构

用户目标 → InputNormalizer / SafetyPolicy → IntentModel → RetrievalService → CandidateSet → SelectionModel → Deterministic Composer → ClaimValidator → AnswerRenderer / DesignProposal

Agent Runtime 负责状态、deadline、工具权限、事件和 fallback；领域层负责目录、价格、规则和方案对象；模型永远不能越过 application service 写正式数据。

## 3. Phase 0：Harness 与 Runtime 决策 spike

目标：判断 Pi 或同类模板应复用代码、只借鉴接口，还是完全自研薄运行时。

文件：

- 新增 docs/design/agent-harness-decision.md
- 新增 src/application/agent/runtime-types.ts
- 新增 src/application/agent/tool-contracts.ts
- 新增 tests/application/agent-harness-spike.test.ts
- 仅在需要时修改 src/application/design/evals.ts

- [ ] 明确 src/application/design/evals.ts 是 EvaluationHarness，只负责固定样本、候选池、模型输出守卫、指标和报告；它不负责线上会话、数据库写入或 Agent 状态。
- [ ] 设计 Agent Runtime 最小接口：run、step、emitEvent、deadline、attemptId、fallback。
- [ ] 只允许三个只读工具进入 spike：searchCatalog、searchEvidence、runCompatibilityCheck。
- [ ] 对 Pi 或同类实现做许可证、依赖、权限模型和上下文压缩审查。
- [ ] 验证四条硬门：模型只能返回候选 ID；模型不能写数据库；模型失败能回退规则路径；压缩上下文后 evidence IDs、qualityStatus、价格状态和规则结果仍存在。
- [ ] 产出复用决策：复用代码、只模仿接口，或自研薄运行时。未完成 spike 决策前不把 Pi 作为生产依赖。

## 4. Phase 1：事实候选管道

目标：让 26,204 条目录数据真正成为可检索、可过滤、可回溯的候选空间。

文件：

- 修改 src/domain/catalog/search.ts
- 新增或审核 src/domain/catalog/ranking.ts
- 修改 src/application/design/service.ts
- 修改 src/infra/catalog-import/load.ts
- 新增 tests/domain/catalog-ranking.test.ts
- 新增 tests/application/design-candidate-pipeline.test.ts

- [ ] 先按类别、质量状态和硬约束过滤，候选只允许 verified / supported。
- [ ] 禁止按数据库加载顺序取前 12 条；排序显式使用质量、关键字段完整度、预算距离、用途/外观匹配、已有硬件约束和价格证据新鲜度。
- [ ] 候选摘要包含 canonicalId、类别、决策规格、qualityStatus、字段状态、source IDs、价格证据状态、缺失字段和 retrievalReasons。
- [ ] 候选不足时返回缺失类别和 unknown，不能用 partial 凑八类。
- [ ] 先用可测量的规范化线性检索；只有评测证明必要时，另立 FTS5 计划。

## 5. Phase 2：价格事实管道

目标：方案价格来自已审核证据，缺证据时诚实未知。

文件：

- 新增或审核 src/application/design/price-context.ts
- 修改 src/infra/db/repositories/price-evidence-repository.ts
- 修改 src/domain/design/proposal.ts
- 修改 src/contracts/design.ts
- 新增 tests/application/design-price-context.test.ts

- [ ] 只有 review_status=verified 且地区匹配的价格进入正式预算区间。
- [ ] 价格上下文携带 evidence IDs、capturedAt、地区和价格口径。
- [ ] 移除 ITEM_PRICE_ESTIMATES 和 PRICE_ESTIMATES 对正式方案的事实作用。
- [ ] 没有已审核价格证据时，价格为 null、priceBasis=unknown，方案显示暂无已审核价格证据。
- [ ] unreviewed、rejected、跨地区价格不得影响预算内判断。

## 6. Phase 3：方案领域模型与质量回溯

目标：每个方案项都能回答来自哪个质量状态、哪些字段已核验、证据是什么。

文件：

- 修改 src/contracts/design.ts
- 修改 src/domain/design/proposal.ts
- 修改 src/application/design/service.ts
- 修改 src/domain/build/types.ts
- 修改 src/application/builds/service.ts
- 修改 src/infra/db/repositories/design-repository.ts
- 新增 tests/domain/design-quality-gate.test.ts

- [ ] 新增 supported_catalog 来源级别。
- [ ] ProposalItem 携带字段质量状态和 evidence source IDs。
- [ ] verified 映射 verified_catalog，supported 映射 supported_catalog，不得硬编码 verified。
- [ ] 接受方案时把字段质量和证据引用传入 BuildItem。
- [ ] 旧方案引用的字段后来变 stale/conflicting 时，重新检查必须输出 unknown 或冲突。
- [ ] 规则层 gateFieldQuality 没有质量信息时不能假装已核验。

## 7. Phase 4：模型选择器，不是固定配置器

目标：模型对动态候选做真正的目标优化，同时不能越权发明事实。

文件：

- 修改 src/application/design/intent-llm.ts
- 修改 src/application/design/service.ts
- 新增 src/application/agent/prompts/selection-v1.ts
- 新增 src/application/agent/prompts/registry.ts
- 新增 tests/application/design-selection-evaluation.test.ts
- 新增 data/evals/design-selection-cases.json

- [ ] 模型输入只包含 Phase 1 的 CandidateSet 和结构化意图，不包含 repository、SQL 或任意原始网页。
- [ ] 模型输出只允许候选 ID、类别和理由；非法 ID、重复类别、越权字段、编造规格、选择不合格质量状态全部拒绝。
- [ ] 模型可以返回部分选择；缺失类别交给规则式补全或转为 needs_input，不能偷偷使用 partial。
- [ ] 模型失败、超时、schema 错误时回退到同一 CandidateSet 上的规则排序，不能回退到固定 PREFERRED_IDS。
- [ ] 允许模型提出多个方案方向，但每个方向都必须经过同一套组合、价格和兼容验证。
- [ ] 理由只能引用 CandidateSet 中的规格、价格状态、证据和用户意图。

## 8. Phase 5：Agent Runtime 与 Claim Ledger

目标：将当前 design service 的过程接入可审计、可回退的 Runtime。

文件：

- 新增 src/contracts/agent.ts
- 新增 src/application/agent/orchestrator.ts
- 新增 src/application/agent/run-state.ts
- 新增 src/application/agent/context.ts
- 新增 src/application/agent/fallback.ts
- 新增 src/application/agent/tools/registry.ts
- 新增 src/application/agent/tools/catalog-tools.ts
- 新增 src/application/agent/tools/evidence-tools.ts
- 新增 src/application/agent/tools/compatibility-tools.ts
- 新增 src/domain/agent/claims.ts
- 新增 src/application/agent/validator.ts
- 新增 tests/application/agent-orchestrator.test.ts
- 新增 tests/agent/claims.test.ts

- [ ] 状态机使用 received → screened → understanding → retrieved → composed → validated → answered，异常状态单独记录。
- [ ] 每个状态变化追加 AgentEvent，保存 promptVersion、model、attemptId、deadline、retrievalIds、toolCalls、fallback 和 errorCode。
- [ ] Tool Registry 只注册只读目录、证据、预算和兼容工具；模型没有写权限。
- [ ] Claim Ledger 区分 catalog fact、price fact、rule result、user fact、experience advice、unknown 和 question。
- [ ] 每个精确事实必须有 source IDs；验证失败降级 unknown 或阻止回答。
- [ ] 上下文压缩只能压缩解释文本，不能删除候选 ID、字段状态、证据 ID、价格状态和规则结果。
- [ ] design/service.ts 先作为兼容 adapter，API 返回结构不变，验证稳定后再逐步收敛。

## 9. Phase 6：评测、回退和发布门禁

文件：

- 修改或审核 src/application/design/evals.ts
- 修改或审核 scripts/run-design-evals.ts
- 新增 tests/agent/adversarial.test.ts
- 新增 tests/agent/grounding.test.ts
- 新增 docs/design/product-core-recovery-review.md

- [ ] 固定样本覆盖预算档位、剪辑+游戏、白色外观、已有电源、商家自拟名、非法型号、候选不足、冲突字段、模型超时、非法 ID、提示词注入。
- [ ] 记录检索候选、模型选择、最终方案、质量状态、价格证据、规则结果、unknown 和 fallback。
- [ ] 精确型号、规格、价格 unsupported claim rate 必须为 0。
- [ ] 未授权工具调用和秘密泄露必须为 0。
- [ ] 评测必须证明模型相对同一 CandidateSet 的规则排序有可测量增益，不能只证明 schema 合法。
- [ ] 模型关闭时，规则排序仍可完成核心流程。

## 10. Phase 7：数据基线和部署边界

文件：README.md、scripts/data-release-gate.ts、fixture 脚本、package.json、相关测试。

- [ ] README 明确当前是本地单用户工具，没有认证和项目隔离，Docker 不得直接暴露公网。
- [ ] 新增临时数据库 fixture，让 fresh clone 能验证 schema、seed 和门禁逻辑；不把空生产库自动判为已发布。
- [ ] 保留真实库 G1–G6 语义。
- [ ] verify-batch 脚本作为可审计重放记录保留，是否移动另立清理计划。

## 11. 暂不合并的技术债

- RSC/server component 数据流重构；
- Drizzle schema 与手写迁移统一；
- Tailwind 依赖和双 token 清理；
- DIY 大组件拆分；
- FTS5 性能优化；
- Docker 镜像瘦身；
- 认证、项目隔离和公开部署。

这些问题真实存在，但不能在产品事实管道未接通前抢占主线。

## 12. 恢复 UI 迭代的门槛

只有同时满足以下条件，才继续新增 UI 组件或视觉功能：

1. 候选来自真实质量过滤后的目录，不是固定 seed 表；
2. 价格不再来自源码常量；
3. partial 不再冒充 verified；
4. 模型候选池相对规则排序有可测量增益；
5. 5–10 个脱敏目标完成检索、价格、质量和规则结果记录；
6. Agent Runtime 的三工具 spike 通过硬门。

## 13. 完整验收

运行：

- npm run gate:data:fixture
- npm run typecheck
- npm run lint
- npm test
- npx playwright test
- npm run build

验收必须确认：目录投入产生真实候选；无 verified 价格时显示 unknown；方案项可回溯质量和证据；质量不可用字段只能输出 unknown；模型失败时规则路径可用；Runtime 不具备任意写入或通用工具能力；fresh clone 能运行 fixture 门禁。
