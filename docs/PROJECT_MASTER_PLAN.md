# RigMate 项目总计划与持续维护手册

**版本：** 1.0  
**日期：** 2026-09-28  
**适用对象：** 主开发 AI、协作开发 AI、产品设计、后续维护者  
**当前主线：** 参考 UI 图驱动的三栏装机决策工作台重构

相关文档：

- 产品业务边界：docs/PC_DIY_装机助手_业务逻辑规格_v1.md
- Agent 技术设计：docs/AGENT_TECHNICAL_DESIGN.md
- 数据来源与质量体系：docs/DATA_PROVENANCE_AND_QUALITY.md
- Agent 平台执行计划：docs/superpowers/plans/2026-09-28-rigmate-agent-platform.md
- Agent 详细设计索引：docs/agent/README.md
- Agent 详细实现计划：docs/superpowers/plans/2026-09-28-agent-detailed-implementation.md
- 技术架构决策：docs/PC_DIY_装机助手_技术架构决策_v1.md
- 系统信息架构：docs/design/10-系统布局规划.md
- 视觉系统：docs/design/00-visual-system.md
- UI 重构设计基线：docs/superpowers/specs/2026-09-28-rigmate-ui-redesign.md
- UI 重构执行计划：docs/superpowers/plans/2026-09-28-rigmate-ui-redesign.md
- AI 协作交接：docs/AI_COLLABORATION.md

---

## 1. 项目最终目标

RigMate 是一个面向 PC 装机与升级决策的工作台。用户不需要先填写 CPU、主板、显卡等字段，而是先描述预算、用途、风格和已有硬件。系统将这些目标整理成结构化意图，基于受约束的硬件目录生成一套可编辑方案，运行确定性兼容检查，并把用户需要判断的取舍放在一个清晰的工作台内。

最终用户闭环：

1. 描述目标。
2. 查看方案摘要和预算区间。
3. 查看每个硬件选择及其理由。
4. 查看 Agent 过程、需求摘要和兼容诊断。
5. 接受方案，或用自然语言提出修改。
6. 进入高级 DIY 精确替换硬件。
7. 保存、重新检查、查看证据和导出报告。

产品的核心不是聊天，而是可解释、可修改、可检查的装机决策结果。任何模型输出都必须落到结构化字段、目录候选、价格证据或确定性规则上。

## 2. 参考 UI 的落地原则

用户提供的两张 UI 图是本项目新的视觉事实源。实现时必须保留以下特征：

- 左侧固定导航，显示品牌、工作区和当前入口。
- 中间主区承载当前决策，配置清单是最重要的信息。
- 右侧上下文栏承载 Agent 进度、需求摘要、兼容性诊断。
- 浅灰白背景、白色面板、蓝灰文字、橙色主动作。
- 方案页用总价、预算范围、配置列表和下一步动作建立层级。
- DIY 页用部件子导航、规格编辑、诊断状态和检查历史建立层级。
- 状态必须同时使用文字、图标和颜色表达，不能只靠颜色。

允许加入的改进：固定长型号表格列、统一状态模型、错误和空状态、响应式折叠、键盘操作、渐进展开依据。不得把界面重新改回当前旧版的技术规格单、深色终端或纯聊天壳。

## 3. 产品范围与明确边界

### 3.1 需要长期维护的核心能力

- 目标输入和预算识别。
- 结构化意图保存与版本化修订。
- 受约束的硬件目录和别名检索。
- 方案候选生成、版本历史和差异展示。
- 八类硬件的精确 DIY 编辑。
- CPU、主板、显卡、内存、存储、电源、散热、机箱兼容检查。
- 价格证据追加式记录和来源展示。
- 检查历史、过期标记和报告导出。
- Agent 事件流、待确认问题和证据引用。

### 3.2 当前阶段不做

- 全网实时比价。
- 未经授权的电商爬虫。
- 自动下单、支付和物流。
- 模型直接断言精确价格、尺寸、接口或兼容性。
- 多 Agent 角色营销和聊天记录式产品主流程。
- 在没有真实数据质量基础时引入向量数据库或复杂工作流编排。
- 一次性拆分为多个后端服务。

### 3.3 未来可选能力

- 报价单图片/PDF OCR。
- 用户账号和云端同步。
- 多地区价格证据。
- 公开分享方案。
- 商家或联盟 API。
- PostgreSQL 和异步任务队列。

未来能力必须先进入变更评审，不能直接在现有页面中临时加入口。

## 4. 系统分层与职责

仓库采用模块化单体，分层如下：

### 4.1 UI 层

目录：src/app、src/ui。

职责：路由、页面编排、状态展示、用户输入、可访问性、响应式布局。UI 层不能直接访问 SQLite、不能直接拼接 SQL、不能把规则判断写在 JSX 中。

### 4.2 Application 层

目录：src/application。

职责：用例编排，例如创建设计请求、生成方案、修订方案、接受方案、保存 Build、运行检查。Application 层可以调用 domain 和 repository，但不能包含页面样式。

### 4.3 Domain 层

目录：src/domain、src/contracts。

职责：纯业务规则、输入校验、状态转换、预算计算、兼容检查、方案差异。Domain 函数优先写成纯函数，便于 Vitest 覆盖。

### 4.4 Infrastructure 层

目录：src/infra。

职责：SQLite、Drizzle、目录导入、LLM 客户端、外部证据来源。Infrastructure 细节不能泄漏到页面组件。

### 4.5 API 层

目录：src/app/api。

职责：解析请求、调用 application service、返回统一 JSON、映射错误状态。API route 不直接实现兼容规则和目录组合。

## 5. 推荐目录结构

后续重构完成后，目标结构如下：

src/app

- page.tsx：目标入口。
- projects/page.tsx：方案库。
- design/[id]/page.tsx：方案审阅和修订。
- diy/page.tsx：高级 DIY。
- hardware/page.tsx：硬件目录。
- evidence/page.tsx：价格证据台账。
- builds/[id]/report/page.tsx：检查报告。
- api：仅保留薄 API route。

src/ui/workbench

- workbench-shell.tsx：三栏壳。
- brand-sidebar.tsx：左侧品牌和导航。
- workspace-header.tsx：顶部标题、预算、版本和主动作。
- agent-progress-card.tsx：Agent 时间线。
- requirement-card.tsx：需求摘要。
- compatibility-panel.tsx：阻断、待补充、通过诊断。
- build-summary-card.tsx：方案摘要和总价。
- build-parts-table.tsx：八类配置清单。
- decision-banner.tsx：用户需要做决定的分歧。
- status-badge.tsx：统一状态标签。
- types.ts：共享 UI 视图类型。

src/domain

- build：Build、预算、指纹和规格。
- catalog：目录检索、候选和来源。
- design：意图、方案、修订和差异。
- price：价格证据和估值。
- review：配置单解析。
- rules：兼容规则和规则引擎。

src/application

- builds/service.ts：Build 创建、更新、删除、检查。
- design/service.ts：设计请求、方案、修订、接受。
- design/intent-llm.ts：模型意图解析适配器。

src/infra

- db/client.ts：数据库连接、表定义、迁移初始化。
- db/repositories：仓储实现。
- catalog-import：目录导入和审计。
- llm/client.ts：可插拔 LLM 客户端。

## 6. 核心领域对象与状态机

### 6.1 DesignRequest

代表用户的一次目标请求。保存原始输入、结构化意图、地区、状态和时间。

状态：

- received：已收到输入。
- understanding：正在整理目标。
- needs_input：缺少生成方案所需信息。
- generating：正在组合方案。
- ready_to_review：已有方案可审阅。
- accepted：某一版已接受为 Build。
- abandoned：用户放弃该请求。

状态只能由 application service 修改。UI 不能通过文案推断状态。

### 6.2 DesignProposal

代表一次不可变的方案版本。每次自然语言修改都生成新的 version，不覆盖旧版本。旧版本只能查看和比较，最新版本才允许修订或接受。

状态：draft、validating、needs_confirmation、ready、accepted、replaced。

### 6.3 Build

代表用户接受后的正式项目。只有 Build 才允许长期 DIY 编辑、保存和检查。候选方案不能直接当成 Build。

### 6.4 AgentRun 与 AgentEvent

AgentRun 代表一次生成或修订运行；AgentEvent 代表过程中的理解、检索、组合、校验、提问、完成和失败。事件是追加式记录，不修改历史事件。

### 6.5 Finding

规则检查结果，状态为 block、warn、unknown、pass、not_applicable。Finding 必须包含 ruleId、状态、结论、证据日期、置信度、假设和涉及的条目。

## 7. 数据契约原则

所有跨层输入输出优先使用 Zod schema，在 contracts 中定义一次。

规则：

1. 金额统一用整数分，显示时转换为人民币元。
2. 时间统一使用 ISO 字符串并在 UI 统一格式化。
3. 缺失值使用 null 或 unknown，不用 0、空字符串伪造已知值。
4. 目录型号必须有 catalogId 才能标记 verified_catalog。
5. 价格估算必须标记 evidence、experience_estimate 或 unknown。
6. 兼容通过不能由模型直接返回，必须由规则引擎计算。
7. 新字段必须先更新 schema、domain 类型、repository 映射和测试，再接 UI。
8. 旧字段兼容期结束前不能直接删除数据库列或 API 字段。

## 8. API 规划

现有 API 继续保留，后续统一错误格式和返回结构。

### 8.1 设计请求

- POST /api/design：创建请求，解析意图，生成第一版方案。
- GET /api/design/id：读取请求、最新方案、版本、运行和事件。
- POST /api/design/id/revisions：提交自然语言修订，生成下一版本。
- POST /api/design/id/accept：接受最新方案，创建或复用 Build。

要求：

- 所有输入使用 contracts schema 校验。
- 404 表示资源不存在，400 表示输入错误，409 表示冲突或不可接受，422 表示语义字段不足，500 表示未预期服务错误。
- 错误返回统一为 { error, code, details? }。
- 接受操作必须幂等，重复请求不能创建多个 Build。

### 8.2 Build

- GET /api/builds：方案列表。
- POST /api/builds：创建空项目或从配置单创建项目。
- GET /api/builds/id：读取项目和条目。
- PATCH /api/builds/id：修改项目基础信息。
- DELETE /api/builds/id：删除项目和级联数据。
- POST /api/builds/id/items：新增条目。
- PATCH /api/builds/id/items/itemId：修改条目。
- DELETE /api/builds/id/items/itemId：删除条目。
- POST /api/builds/id/check：运行兼容检查。
- GET /api/builds/id/check/history：读取检查历史。

### 8.3 资料与证据

- GET /api/catalog：按类别、关键词和别名查询目录。
- GET /api/catalog/overview：目录规模、来源和更新时间。
- GET /api/evidence：按类别、产品和来源过滤价格证据。

## 9. 前端工作台设计系统

### 9.1 三栏布局

桌面：左侧 220px，主区 minmax(0, 1fr)，右侧 340px，页面最大宽度约 1440px。

中等宽度：左栏缩至 184px，右栏保留摘要，详细依据改为展开面板。

移动端：左栏变成顶部菜单，主区先显示结果，Agent 和诊断随后显示。所有表格允许横向内部滚动，但页面本身不能横向滚动。

### 9.2 组件规则

- 组件只通过 props 接收数据和事件回调。
- API 请求放在页面或 application adapter 中。
- 组件不直接读取 URL 参数以外的隐式全局状态。
- 组件的 loading、empty、error、success 状态必须同时存在。
- 主要按钮使用动词加对象，例如接受这一版、保存修改、重新检查。
- 依据默认折叠，用户明确展开后才显示规则编号和来源细节。

### 9.3 状态呈现

loading：骨架和当前步骤。ready：绿色或中性色状态和主动作。attention：琥珀色并写清取舍。conflict：红色并提供解决动作。unknown：灰色并列出缺失资料。accepted：绿色完成态并提供进入 DIY。error：保留已有数据并提供重试。

## 10. Agent 演进路线

### 阶段 A：规则式生成保持稳定

当前方案生成仍可使用预算分档和目录候选。界面必须诚实显示规则式生成、经验估算和待确认字段。

### 阶段 B：模型只做结构化意图

模型输入原始目标，输出 StructuredIntent。输出必须经过 schema 校验，失败则回退本地解析。模型不能返回不存在的商品型号作为事实。

### 阶段 C：受约束候选选择

系统先从 canonical_products 检索候选，再把候选 ID 和规格摘要交给模型排序或解释。模型只能返回候选中的 catalogId。非法 ID 必须拒绝并回退规则式选择。

### 阶段 D：证据和规则编排

价格、尺寸、接口和兼容性由系统工具提供。模型负责把这些事实整理成用户可读的理由和取舍。每条理由保存 sourceLevel 和证据引用。

### 阶段 E：异步 Agent 运行

只有在单请求执行时间明显影响体验时，才引入任务队列或 worker。迁移前先定义幂等键、重试策略、超时、取消和事件顺序。

## 11. 数据库与迁移维护

当前 SQLite 适合单机和早期用户。迁移纪律：

1. 每个迁移必须幂等。
2. schema_version 只有在迁移成功后才前进。
3. 不直接删除旧列，先增加新列、双写、回填、验证，再在单独版本中删除。
4. 每个迁移必须有一个持久化回归测试。
5. 修改 migrate.ts 后必须重启开发服务器。
6. 真实用户项目不能通过测试脚本删除。
7. 导入目录必须保留 upstream commit、许可证、来源路径和导入审计。

当出现以下信号时评估 PostgreSQL：多用户并发写入、云端部署、多实例服务、备份恢复需求或 SQLite 锁竞争。迁移数据库不等于重写领域和 application 层。

## 12. 测试策略

### 12.1 单元测试

覆盖 domain 纯函数：预算、指纹、意图解析、方案选择、差异、目录检索、每条兼容规则、状态映射。测试要包含缺字段、未知、边界尺寸、超预算和冲突。

### 12.2 Application 测试

覆盖创建设计、修订、接受幂等、冲突拒绝、允许冲突进入 DIY、检查历史和目录候选限制。使用内存或临时 SQLite，测试结束后清理临时库。

### 12.3 API 测试

覆盖 schema 失败、404、409、重复请求、服务错误和错误结构。API 测试不依赖真实 LLM 或网络。

### 12.4 E2E 测试

最少保留以下主链路：

1. 首页提交目标并进入方案页。
2. 方案页查看配置、依据、Agent 事件和版本。
3. 自然语言修订生成新版本。
4. 冲突方案不能直接接受。
5. 接受方案后进入 DIY。
6. DIY 修改、保存、重新检查和查看历史。
7. 项目、硬件、证据和报告路由可访问。
8. 移动端没有横向滚动。

## 13. 质量门禁

每个功能提交前必须执行：

- npm run typecheck
- npm run lint
- npm test
- 与改动相关的 Playwright 测试

合并前执行：

- npm run test:e2e
- npm run build
- 1440px 和 390px 截图检查

失败处理：先定位是代码回归、环境问题、测试数据污染还是既有基线问题。不得为了让测试通过而放宽业务断言或删除真实数据。

## 14. 开发协作规则

### 14.1 AI 开始工作前

1. 读取 AGENTS.md。
2. 读取 docs/AI_COLLABORATION.md。
3. 读取本文件和对应模块文档。
4. 运行 git status、git log -5 和相关测试。
5. 先说明准备修改的文件和不修改的边界。

### 14.2 需求变更流程

1. 先修改业务规格或 UI 设计基线。
2. 更新本文件中的目标、契约或里程碑。
3. 写实现计划，列出文件、测试和迁移方式。
4. 先更新 schema/domain，再更新 application/API，最后更新 UI。
5. 完成测试后更新 AI_COLLABORATION.md 的进度快照。

### 14.3 提交规范

推荐使用：

- feat：新功能。
- fix：错误修复。
- refactor：不改变行为的结构调整。
- test：测试。
- docs：文档。
- chore：工具和依赖。

一个提交只解决一个清晰主题。数据库迁移、领域契约、页面重构和视觉调参尽量拆开。

## 15. 完整里程碑路线

### M36：目录与证据质量

目标：建立高频推荐池、别名、规格完整度和来源审计。退出条件：目录候选可追溯，关键字段缺失会显示 unknown。

### M37：UI 工作台壳

目标：按参考图完成 WorkbenchShell、导航、顶部工作栏、右侧上下文栏和 token。退出条件：首页、方案页、DIY 页共用同一壳。

### M38：首页与方案审阅

目标：完成目标输入、方案摘要、配置清单、Agent 时间线、需求摘要、修订和接受。退出条件：主链路 E2E 全绿。

### M39：DIY 和诊断

目标：完成第二张图风格的高级 DIY、三态诊断、检查历史和保存反馈。退出条件：八类硬件编辑和规则检查无回退。

### M40：资料和报告统一

目标：项目、硬件、证据、报告页接入同一导航和视觉系统。退出条件：所有旧路由可访问，证据链可回溯。

### M41：受约束 Agent 选件

目标：候选先由目录检索，模型只返回候选 ID，规则引擎负责精确检查。退出条件：非法候选自动拒绝，真实样本评测达到预设准确率。

### M42：部署与恢复

目标：备份、日志、错误监控、数据库恢复和生产构建。退出条件：能从备份恢复一个完整项目和检查历史。

### M43：公开试用

目标：邀请少量用户完成目标输入、方案接受、DIY 和反馈闭环。退出条件：记录真实任务完成率、冲突处理率、未知项率和用户反馈。

## 16. 维护清单

每周：检查测试基线、目录导入失败、未处理错误日志、数据备份。

每个里程碑：更新 AI_COLLABORATION.md、变更日志、迁移版本、截图和退出条件。

每次目录导入：记录来源 commit、许可证、导入数量、跳过数量、错误数量和抽样核对结果。

每次 Agent 变更：保存一组固定样本，比较意图解析、候选选择、兼容状态、未知字段和理由质量。

每次 UI 变更：至少检查桌面宽屏、桌面窄屏、手机宽度、loading、empty、error、conflict、unknown、accepted 九种状态。

## 17. 交付给下一位 AI 的最小上下文

下一位 AI 不需要猜测项目方向，只需依次阅读：

1. AGENTS.md。
2. docs/AI_COLLABORATION.md。
3. docs/PROJECT_MASTER_PLAN.md。
4. docs/superpowers/specs/2026-09-28-rigmate-ui-redesign.md。
5. docs/superpowers/plans/2026-09-28-rigmate-ui-redesign.md。
6. 与当前任务相关的 contracts、application、domain、repository 和测试。

如果实现计划与业务规格冲突，以最新的用户确认和业务规格为准，并在开始编码前更新本文档。任何不确定事实都必须显示为待补充或待确认，不能为了界面完整而猜测。

## 18. 完成定义

项目达到长期可维护状态，需要同时满足：

- 主要页面使用参考 UI 图风格的统一三栏工作台。
- 业务核心仍由 domain 和规则引擎控制，UI 不承载业务真相。
- API、schema、数据库、repository 和页面之间没有隐式字段漂移。
- 方案版本、Agent 事件、检查历史和价格证据可追溯。
- loading、empty、error、conflict、unknown、accepted 状态完整。
- 单元、Application、API、E2E 和生产构建通过。
- 任何协作者都能通过文档、测试和 Git 历史继续开发，而不需要依赖口头记忆。
