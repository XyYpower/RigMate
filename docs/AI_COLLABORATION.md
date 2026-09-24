# RigMate AI 协同开发报告

> **本文档的用途**：AI 协同开发的"进度锚点"。每完成一个大的功能板块，AI 必须更新本文档（进度快照、里程碑、下一步），然后 git 提交推送——这是与用户约定的固定动作。
> **任何新会话 / 协作者，开工前先完整读完本文档，再按需读第 2 节的文档，不要凭猜测继续开发。**
>
> 最后更新：2026-09-24 ｜ 当前阶段：**M33 已完成，V2 产品成型路线已定**——前端体验先行，首批面向新手的可追溯配置生成；M34–M39 路线见 `docs/superpowers/specs/2026-09-24-v2-product-design.md`。现有 V2 主链路可用，但 LLM 只负责意图理解，选件仍为固定预算档位。
> **换窗口交接：先读 §0 交接快照。**
> 仓库：<https://github.com/XyYpower/RigMate>（main 分支）｜ 本地：`D:\XyyWork\RigMate`

---

## 0. 交接快照（2026-09-24 M33 产品化收口后状态，新窗口先读这节）

- **Git**：M27-M33 已提交至 `1112bf8`；本节所述 V2 规划为后续文档变更，远程状态以 `git status -sb` 和推送结果为准。
- **测试基线**：166 单测 + 19 E2E 全绿（含检查历史断言）；lint / typecheck / build 通过；8 状态截图视觉验收通过（桌面 1280 + 窄屏 390，截图目录 D:/tmp/rigmate-shots2/）。
- **本机注意事项**：
  - E2E 需 `RIGMATE_E2E_EXECUTABLE_PATH`（见 §6）；**E2E 必须在"静默机器"上跑**——若同机还有 dev server/构建在跑，会出现 5 倍耗时与超时雪崩（2026-09-22 实证，两个假失败由此而来，清场重跑即绿）；
  - E2E webServer 是 `next dev`（3100 端口，`reuseExistingServer: true`），**新路由首次访问有编译延迟**，断言默认 5s 超时；
  - 开发库现存用户真实项目 2 个（9ca80d6e=98x3D/微型X874 两件；51345d25=用户 09-22 自建测试项目三件）——**都不要删**；
  - dev server（3000 端口）可能由本窗口遗留进程跑着，接手先查端口；
  - **改 migrate.ts 后必须重启 dev server**（迁移每进程只跑一次；v6 已含 design 五表）；
  - **Bash 工作目录会漂移**：命令一律先 `cd /d/XyyWork/RigMate`；
  - GitHub 推送偶发闪断，重试即可。
- **功能现状**：V1-A 全部（M1-M26，见 §3/§4）+ **M27 产品方向重校准**（业务规格 V2 / 系统布局 v2 / 视觉母版方案工作台版）+ **M28 目标驱动垂直切片**：`/` 自然语言目标入口（FormData 原生提交，预算可从描述识别"2 万/2w/8000"）→ POST /api/design → `src/domain/design/`（意图解析 intent.ts + 预算分档候选 proposal.ts，纯函数）→ `design_requests/design_proposals/proposal_items/agent_runs/agent_events` 五表（v6 迁移）→ `/design/[id]` 审阅页（方案主视觉 + Agent 活动流 + 依据折叠 + 兼容冲突禁接受）→ POST /api/design/[id]/accept（幂等，复用 createBuild/addBuildItem/checkBuild，自动跑检查）→ `/diy?project=` 高级 DIY。旧 869 行工作台整体迁至 `/diy/page.tsx`，功能契约与 E2E 全部保留。
- **产品方向（M27）**：普通用户从自然语言目标开始，Agent 生成可编辑方案并自动校验；经验用户在同一方案中进入 `/diy` 高级工作台。旧的"副驾最后接入"与"选件→手动检查→导出"不再是 V2 主流程。
- **诚实边界（重要）**：当前方案生成 = **本地目录规则式分档选择**（预算 <1.4万 → 9600X/4060/650W；1.4-2.3万 → 9800X3D/4070S/850W；≥2.3万 → 4090 档），价格区间为按型号的经验估算（界面标注"经验估算，非实时成交价"），**尚未接入 LLM/RAG**。Agent 活动流文案如实写"本地目录就绪…按预算档位挑选候选"。禁止把规则式生成说成"AI 智能搭配"。
- **设计单一事实源**：`docs/design/10-系统布局规划.md` v2；视觉层 `docs/design/README.md` 与 `00-visual-system.md`。
- **可信边界**：现有 `Build`/`BuildItem` 继续表示用户接受后的正式方案；Agent 生成中的候选存为 DesignProposal；兼容冲突的草稿服务端拒绝直接接受（409），"自己调整配置"以 allowConflicts 显式进入 DIY 但检查结果照实保留冲突。
- **数据现状（M29 后）**：自有规格库 `canonical_products` 表（v7 迁移）为运行时首选——`npm run catalog:db` 一键把 种子 34 + 人工 49 + BuildCores 26,121 清洗入库（幂等，同 id 先到先得）；库为空时自动回退 JSON 三层合并（历史行为）。ZOL 补缺走 `npm run catalog:db -- --update <file>`（只填缺失字段、不覆盖已核值、不允许静默创建新品）。字段纪律 = 只存决策字段（specs.ts 每类 2-8 个）+ 可选 refUrl；商品页链接缺失时前端按型号拼京东搜索链接兜底（只链不爬）。上游克隆在 `data/buildcores-open-db/`；规格查证剩余字段等搜索配额 2026-09-28 重置后补查。
- **架构决策（2026-09-23）**：评估并否决"整体套用 zai-org/ZCode 开源工作台改造 UI"——产品对象不匹配/集成重量失控/深色 IDE 风是已否决路线（ADR §3.6）；允许逐件拆用 Vercel `ai-elements`（Apache-2.0，npm 独立包）做 M30+ 副驾组件。
- **样本进度**：11/20 份（samples/，配比 整机10+自购10——**缺自购单**，用户收集中）。
- **下一项工作**：先做 M34 体验基线与可运行前端原型：目标入口、方案工作台、硬件查询、始终可达的自然语言修订输入、生成/追问/阻断/差异/失败状态，桌面优先且手机可用。演示数据必须显式标记，不能接正式接受/导出。随后 M35 接真实 API 与版本浏览，M36 做目录与证据质量，M37 做受约束的模型选件，M38 部署与完整闭环，M39 公开试用。详细范围与退出条件见新设计文档。
- **本轮用户确认的方向**：首批服务新手；Agent 调大模型协助生成配置，但候选、规格、价格和兼容结论必须有系统数据与规则支撑；可整体重构前端，要求简洁、清楚、舒服；参考开源 Agent 工作台的信息层级与任务状态，不整体移植代码或通用聊天壳。首轮交付可运行前端原型，桌面优先、手机适配。
- **前端所有权**：归 AI 窗口（全栈）。

## 1. 一分钟了解项目

- **产品定位**：面向 PC 装机与升级决策的 Agent 工作台——用户说目标（如"2 万预算白色海景房剪辑+游戏"），系统生成可编辑方案并自动校验；经验用户走 `/diy` 逐项精调。
- **核心理念**：目标驱动 + 确定性规则 + 可追溯证据；缺数据时诚实输出"待补充/未知"，**绝不猜默认值**；价格按证据或经验估算分别标记，当前选件如实写"规则式生成"。
- **明确不做**（红线，见业务规格 V2 §12）：全网实时比价、电商爬虫、自动下单、价格预测、多 Agent 宣传、未经授权的数据集、把模型经验冒充精确事实。
- **技术形态**：Next.js 16 + React 19 + TypeScript 模块化单体；SQLite（WAL 模式）+ Drizzle ORM；Vitest + Playwright。
- **当前状态**：V2 目标驱动主链路本地可用；可插拔 LLM 可理解目标和修订意图，选件仍是规则式预算分档。尚未部署公网，也未让模型在受约束的目录候选中生成组合。

## 2. 必读文档（按顺序）

| 顺序 | 文档 | 作用 |
|---|---|---|
| 1 | `docs/PC_DIY_装机助手_业务逻辑规格_v1.md` | 业务单一事实来源：范围、规则定义、数据模型、验收标准。**需求变更先改这里再改代码** |
| 2 | `docs/PC_DIY_装机助手_技术架构决策_v1.md` | 技术选型 ADR：为什么是 Next.js/SQLite/自研规则引擎，为什么不用那些 |
| 3 | `docs/PC_DIY_装机助手_前端UI设计_v1.md` | 前端 UI 设计参考（用户添加） |
| 4 | 本文档 | 当前进度、已知问题、协同约定 |

## 3. 进度快照（V1-A 清单）

| 事项 | 状态 |
|---|---|
| 工程骨架 + 质量门禁（lint / typecheck / vitest / build / e2e） | ✅ 完成 |
| SQLite 持久化（仓储层 + 懒初始化单例 + 自动建表迁移） | ✅ 完成 |
| 八类配件录入（CPU/主板/显卡/内存/存储/电源/散热器/机箱，spec JSON + Zod 分类校验） | ✅ 完成 |
| 12 条确定性兼容性规则 + 阻断→待补充→警告→通过优先级报告 | ✅ 完成 |
| 检查结果落库 + 刷新后恢复 + 过期标记（清单指纹对比） | ✅ 完成 |
| 历史项目切换 / 删除（两步确认）/ 表单草稿按类别隔离 | ✅ 完成 |
| UI F1 铺底：语义状态 tokens + 六要素诊断卡组件 | ✅ 完成 |
| 前端版式 v3：技术规格单（去卡片化 / 等宽数据 / 报告式诊断条款） | ✅ 完成（M16） |
| 预算字段与价格手动录入 | ✅ 完成（M10 后端契约 + M13 预算余量计与价格/预算录入） |
| 标准型号目录（种子数据 + 点选自动带出规格 + 来源标记） | ✅ 完成（M17）；候选模糊匹配与目录运营为后续增强 |
| 配件条目编辑 / 删除（PATCH/DELETE + 编辑态表单 + 两步确认） | ✅ 完成（M14） |
| 数据库迁移版本检测（schema_version + 版本化迁移 + 启动日志 + 降级拒绝） | ✅ 完成（M18） |
| 目录批量录入工具（CSV 模板 + 导入命令 + 审计，M20 方案 A） | ✅ 完成（M20，预填 49 条已入库） |
| UI 系统化：视觉母版（12 SVG 画板 + 生成脚本） | ✅ 完成（M21，docs/design/） |
| UI 系统化：导航壳 + 硬件中心 + 占位页 + 目录总览 API | ✅ 完成（M22，系统布局第一步） |
| UI 系统化：方案库 /projects（项目列表 + ?project 直达 + 复核入口） | ✅ 完成（M23，系统布局第三步） |
| 报告导出 /builds/[id]/report（图框标题栏 + 按状态分组条款 + 打印/PDF） | ✅ 完成（M24，系统布局第四步·三步流闭环） |
| 整机复核：粘贴配置单 → 解析 → 候选确认 → 一键建项目检查 | ✅ 完成（M25，方案库内） |
| 证据台账 /evidence（price_evidence 追加式快照 + 手动录入 + 过滤） | ✅ 完成（M26，v5 迁移） |
| 产品方向重校准：业务规格 V2 + 系统布局 v2 + 视觉母版方案工作台版 | ✅ 完成（M27，只改文档） |
| 目标驱动垂直切片：/ 目标入口 + /design/[id] 审阅 + 接受进 DIY（v6 迁移五表） | ✅ 完成（M28，规则式生成，LLM 未接） |
| BuildCores 目录导入器（离线导入 + commit 固定 + ODC-By 署名 + 审计表） | ✅ 完成（M19，已导入 26,121 条） |
| 业务验证：20 份真实清单样本（已 11 份，目标配比 整机10+自购10）+ 5-10 名用户访谈 | 🔶 进行中（用户收集） |
| V1-B：替代方案 / 估值曲线（价格证据链已由 M26 台账承担录入侧） | ⬜ |
| M30：可插拔 LLM 意图解析（结构化输出 + 降级；非完整 RAG/模型选件） | ✅ 完成 |
| M31：自然语言修订方案 / M32：版本差异与 DIY 渐进披露 / M33：产品化收口 | ✅ 完成 |
| V1-C：联盟 API / OCR 报价单入口 / PostgreSQL | ⬜ |

## 4. 已完成里程碑

### M1（2026-09-20）Phase 0：第一条垂直切片
初始化 Next.js 项目与 Git；实现 `R-CPU-MB-001`（CPU/主板插槽）规则 + DIY 工作台页面 + API + 单元/E2E 测试。关键文件：`src/domain/rules/`、`src/app/page.tsx`。

### M2（2026-09-20）SQLite 持久化
应用服务从内存 Map 切换到仓储层（`src/infra/db/repositories/build-repository.ts`）；数据库客户端改为懒初始化单例（挂 `globalThis` 防 HMR 多连接）；`serverExternalPackages` 加入 better-sqlite3；增加"关闭连接重开后数据仍在"回归测试。

### M3（2026-09-20）八类配件 + 完整规则引擎
`build_items` 迁移到 `spec` JSON 列（幂等迁移：旧 socket 列数据并入后删除）；`src/domain/build/specs.ts` 定义八类规格 schema；实现全部 12 条规则（见 `src/domain/rules/engine.ts` 注册表）；报告按优先级排序；缺字段规则输出 `unknown` 并列出缺失项。

### M4（2026-09-20）项目管理与表单修复
页面加载自动恢复最近项目；历史项目切换器；表单草稿按类别隔离（`{label, fields}` 结构）。**修复过的 bug（勿回归）**：① 请求在途时返回值覆盖用户输入（现已 busy 时禁用表单）；② 型号输入框八类共用导致数据串台（现已按类别隔离）；③ 恢复逻辑覆盖用户正在输入的项目名（现已不回填名称/用途字段）。

### M5（2026-09-20）结果恢复 + 过期标记 + 删除
`check_runs` 增加 `items_snapshot` 清单指纹列；`GET /api/builds/[id]/check` 返回最近一次检查（对比指纹得出 `stale`）；`DELETE /api/builds/[id]` 级联删除项目/配件/检查记录；UI 增加结果时间、过期横幅、两步确认删除。

### M6（2026-09-20）Git 基线
全部代码推送到 GitHub（39 文件，main 分支）。远程为本机 `origin`，gh CLI 以 XyYpower 登录。

### M7（2026-09-20）UI F1 铺底（前端 UI 窗口）
按 `docs/PC_DIY_装机助手_前端UI设计_v1.md` §8/§5.3 落地第一批**纯增量** UI 基建：
- `src/ui/theme.css`：`--rm-*` 设计 tokens（五种语义色 + 深色基底），`globals.css` 已引入，零视觉影响；
- `src/ui/finding-model.ts`：状态语义映射（含 unknown=虚线幽灵）+ 六要素视图模型纯函数；
- `src/ui/components/`：`StatusChip` / `EvidenceStamp`（证据三件套）/ `FindingCard`（六要素诊断卡，预留画布联动 onFocusItems）；
- 新增 `tests/ui/finding-model.test.ts` 7 个用例，全量 58 通过；lint / typecheck / build 通过。

**未修改 page.tsx / category-form.ts**——避免与"预算字段录入"开发冲突；组件接线在三栏改造时进行。注意：现 page.tsx 本地 Finding 类型丢失了领域层的 dataDate/confidence/assumptions 字段，接线时用组件替换内联渲染即可补齐六要素。

### M8（2026-09-20）删除体验修复 + 历史可辨识
用户反馈"删除项目功能不好用"。排查结论：删除机制在数据库层正常，真问题是 **UI 无法体现删除发生了**——所有项目同名（默认名），删除后自动切换到的项目与被删项目同名同貌，看起来像没删。修复：
- 历史下拉每项带配件数与更新时间：`名字（N 配件 · MM/DD HH:mm）`，同名项目可辨识；
- 确认按钮文案带项目名：`确认删除「xxx」？再点一次`；
- `createProject` 现在会重置确认态（此前确认态跨新建残留，可能误删下一个项目）；
- E2E 增加删除持久化断言（删除后历史选项数 -1，刷新后仍保持）；
- 协同清理：按 ID 删除 6 个自动化测试生成的项目，保留用户真实项目（配件"9800X3d"）。
关键文件：`src/app/page.tsx`、`tests/e2e/diy-workbench.spec.ts`。

### M9（2026-09-20）前端重写落地：三栏装机台 + 深色主题 + 机器画布（前端窗口）
按 `docs/PC_DIY_装机助手_前端UI设计_v1.md` 与 §11 交接契约完成 F1 接线，**只改动冻结区文件**：
- `src/app/page.tsx`：三栏布局（左=项目+录入 / 中=机器画布+清单 / 右=诊断流）；状态逻辑零改动，§11 的 7 条功能契约全部保留；
- `src/app/globals.css`：整体切换深色硬件终端主题（蓝图网格底纹，消费 `--rm-*` tokens），含 1240px/860px 两级响应式；
- `src/ui/canvas/layout.ts`：画布布局引擎（纯函数）——spec 毫米数字 → 比例正确的机箱剖视；显卡限长/散热器限高/板型支持超差标红，缺规格部件渲染虚线幽灵件；
- `src/ui/canvas/build-canvas.tsx`：SVG 渲染（部件/限长限高标尺/图例/越界说明）；
- 诊断流接入 `FindingCard`（补齐数据日期/置信度/假设条件三要素，此前 page.tsx 本地类型丢失）与 `StatusChip`（计数章）；接入领域层 `Finding` 类型，删除页内降级类型；
- 测试：新增 `tests/ui/canvas-layout.test.ts` 8 用例；E2E 一处选择器改精确匹配（画布悬浮提示与清单行文案相同导致 strict mode 冲突）；**E2E 6/6 全绿**，lint/typecheck/build 通过，并经真实浏览器截图视觉验收。

### M10（2026-09-20）预算后端契约（前端无碰撞）
预算 UI 属于设计稿 F2「行情台」，本窗口只实现领域/数据库/服务契约，**没有修改前端重写冻结区文件**：
- `src/domain/build/budget.ts`：纯函数 `computeBudgetSummary`，按业务规格 §10.1 区分已计价/未计价；未知金额不按零元计入；返回 `pricedTotalCents`、`pricedCount`、`unpricedCount`、`unpricedLabels`、`differenceCents`；
- `build_items.price_cents`：SQLite 可选整数列，幂等迁移；仓储读写映射已补齐；
- `BuildItemInput` 接受可选 `priceCents`；`Build` 响应附带非持久化 `budgetSummary`，不破坏现有 API 消费者；
- `createBuild` 已有 `budgetCents`，现在服务响应会随项目返回预算汇总；
- 测试覆盖五种业务情况（全计价、部分未计价、无预算、超预算、空清单）+ 价格重启持久化；全量 **73 个单元测试**通过。

**前端接线契约（给 UI 重写窗口）**：项目响应里的 `budgetSummary` 直接可渲染 F2 §6.3：预算水平线=`budgetCents`、已计价金额=`pricedTotalCents`、未计价件数/标签=`unpricedCount/unpricedLabels`；未知件永远不能按 0 元画入估值曲线。录入价格时提交条目体 `{ category, label, spec, priceCents }`，金额单位为分，整数正数。



### M11（2026-09-20）WebGL 氛围背景 + 画布降级为尺寸核对示意（前端窗口）
与用户对齐后澄清：用户要的"3D 感"是**页面氛围背景**，不是 3D 画图功能（M9 的机器画布系方向误解产物）。本轮：
- `src/ui/ambient-background.tsx`：零依赖原生 WebGL 片元着色器背景——流动微光雾 + 游走辉光 + 蓝图网格 + 鼠标视差；DPR 上限 1.25、low-power、标签页隐藏暂停、`prefers-reduced-motion` 渲染静态单帧、WebGL 不可用回退 body 静态网格；挂在 `layout.tsx` 全局生效；
- 机器画布按用户选择降级：改名"尺寸核对示意图"移至清单下方，明示"规则示意图、非渲染图、不代表配件真实外观"；
- 门禁：lint/typecheck 通过，E2E 6/6 全绿，真实浏览器截图视觉验收；
- 接到 M10 的预算接线契约：下一步在右栏加预算汇总卡（budgetSummary / priceCents，单位分）。

### M12（2026-09-20）尺寸核对示意下架（前端窗口）
用户实际查看后判断该功能当前无用，决策成立：V1-A 手动录入阶段规格数据稀疏，画布绝大多数时候只显示虚线幽灵件。处置：
- `src/app/page.tsx` 移除画布面板（诊断栏编号 05→04），页面回到"清单 + 诊断流"两栏重心；
- `src/ui/canvas/`（布局引擎 + SVG 组件）与 `tests/ui/canvas-layout.test.ts` **保留休眠**；复活条件见前端 UI 设计文档 §5.2 状态注记——标准型号目录上线、尺寸规格可自动带出时再以小部件形式回归。

### M13（2026-09-20）仪器白主题 + 预算余量计（本窗口，前后端全栈）
用户反馈深色主题"有点大众"，定向：亮色、克制、去大众化。本窗口接手前端（M9-M12 交接完成，§11 冻结解除）：
- **主题换肤**：`theme.css` tokens 重调为「仪器白」——暖白面板 + 点阵底纹 + 发丝线 + 墨黑数字 + 仪器橙单一强调色；数字一律 tabular-nums；诊断卡/计数章经 `--rm-*` 变量自动换肤，组件零改动；
- **WebGL 微光氛围背景下架**：`layout.tsx` 移除挂载，组件留库休眠（它和黑底一起构成"大众 AI 面板"观感）；
- **预算余量计**（§10.1 + 设计稿 §6.3，PSU 余量表语言）：中栏新增仪表盘——四个读数（预算水平线/已计价/未计价/余量或超支）+ 刻度条（墨色填充=已计价，斜纹=未计价幽灵区间，25% 刻度线）+ 幽灵件说明；未设置预算时显示引导文案；
- **价格/预算录入**：配件表单加「价格（元）· 可选」（元→分换算，正数校验），清单行显示价格；创建项目表单加「预算（元）」；
- 测试：E2E 新增预算全链路用例（价格录入→未计价件→差额→刷新持久），**7/7 全绿**；全量 73 单元测试 + lint/typecheck/build 通过，真实浏览器截图验收。

### M14（2026-09-20）配件编辑 / 删除（本窗口）
补上最后一个影响实际使用的缺口：配件此前只能追加，录错只能删整个项目重建。
- **接口**：`PATCH /api/builds/[id]/items/[itemId]`（部分更新，类别固定）与 `DELETE`（两步确认由前端承担）；`ITEM_NOT_FOUND` 与 `BUILD_NOT_FOUND` 分别返回 404；
- **服务层**：`updateBuildItem` / `deleteBuildItem` —— 更新后状态回 `needs_confirmation`，`updatedAt` 刷新；清单指纹变化使旧检查结果自动标记过期（复用 M5 机制）；
- **表单编辑态**：清单行「改」→ 表单切到"编辑配件"，字段按类别反向回填（新增 `specToFormValues`，与 `buildSpecPayload` 互为逆操作），价格分→元回填；「保存修改」提交 PATCH，「取消编辑」还原；切换类别或项目自动退出编辑；
- **清单行操作**：每行「改 / 删」按钮（仪器风格小方钮），删除为两步确认（`删` → `确认删`），编辑中的行有橙色左边框高亮；删除仅删配件、保留项目；
- **测试**：服务层 +4（编辑后过期、类别不漂移、删除同步预算、ITEM_NOT_FOUND）；E2E +1 全链路（编辑主板 LGA1700→AM5 使阻断转通过、删除 CPU、刷新后持久）；**全量 77 单元测试 + 8 条 E2E 全绿**，浏览器实测编辑态与行内操作。

### M15（2026-09-20）版式 v2「仪器台」+ E2E 隔离（本窗口）
用户反馈"排版太丑"。此前是三栏并排的面板堆叠，竖向高度不齐、信息密度与视觉节奏缺失。本轮按设计文档意图重做版式：
- **顶栏承载身份与主操作**（对齐设计稿 §5.1）：品牌 + 标语左侧，规则引擎状态 + 主按钮「运行兼容性检查」右侧；
- **项目栏**：一行配置（历史项目 / 新项目名称 / 用途 / 预算 + 新建、删除），输入统一下划线式（instrument 语言，去边框盒感）；
- **预算仪表条**：从四块瓷砖改为整机仪表读数带——预算水平线 / 已计价 / 未计价 / 余量 + 刻度尺（墨色填充=已计价，超支转红压满）；斜纹幽灵区仅在存在未计价件时显示（语义修正：无未计价件时不该暗示"还有未知花费"）；
- **两栏主区**：左 1.3fr 装机单（**规格表**：类型 / 型号规格 / 价格 / 状态 / 操作 五列对齐 + 列头）与配件录入（字段两列网格），右 1fr 诊断流；
- **诊断卡**：左侧状态色条 + 结论行（右对齐规则号）+ 状态/日期/置信度元信息行 + 证据 + 待补充 + 假设 + 下一步（六要素齐备，密度提高）；
- **样式系统**：globals.css 全量重写为版式 v2 命名（topbar/projectbar/budget-strip/main/panel/colhead/item-row/finding），CSS 变量与语义色不变；
- **E2E 隔离**：测试改用独立端口 3100 + `data/e2e.db` + 独立构建目录 `.next-e2e`（`next.config.ts` 支持 `NEXT_DIST_DIR`），eslint/gitignore 同步忽略；并清理开发库中 21 个历史测试项目（保留用户真实项目）；
- 验证：77 单元测试 + 8 条 E2E 全绿；浏览器多状态视觉验收（无预算 / 超支 / 编辑态 / 用户真实项目）。

### M16（2026-09-20）版式 v3「技术规格单」：去 AI 味重构（本窗口）
用户反馈"AI 味仍重"。诊断出五类典型 AI 界面特征并逐条消除：
1. 满屏 micro-caps 英文小标签（BUILD SHEET / PART ENTRY / DIAGNOSTICS）→ 全部删除；
2. 所有内容装进带边框卡片面板 → **去卡片化**，改用发丝线分区（印刷规格单结构）；
3. 空状态图标 + 虚线框 → 收成一行安静的文字；
4. 圆角药丸 chip + 彩色底纹徽章 → 类别选择改**下划线标签页**，状态改纯文字；
5. 数字与正文同观感 → 价格/计数/规则号/时间/尺寸统一等宽字体（`ui-monospace` + `tabular-nums`）并右对齐。

结构重排：报头（品牌 + 规则引擎状态）→ 项目栏（新建/切换/删除一行）→ 标题行（项目名 + 用途/更新时间 + 主检查按钮）→ 数据行（预算/已计价/未计价/余量，等宽数字）+ 细标尺余量尺 → 两栏发丝线分区（清单规格表 / 诊断条款）。
诊断改为**报告式条款**：左侧页边状态词（阻断/警告/待补充/通过）+ 右侧结论、规则号、数据日期与置信度、证据、建议动作。
CSS 变量与语义色不变（`--rm-*` 体系延续）；`finding-card` / `status-chip` / `evidence-stamp` 同步改为版式 v3 类名。
验证：77 单元测试 + 8 条 E2E 全绿（修正一处文案锚点：结果时间冒号回归）；浏览器多状态视觉验收（无预算 / 有预算 / 超支 / 诊断条款 / 用户真实项目）。

### M17（2026-09-20）标准型号目录 v1（本窗口）
- **种子目录**：`src/domain/catalog/seed.ts`——8 类 34 条高频型号。数据纪律：每条目只带公开资料可靠的高置信字段；GPU 只带官方 TDP/供电接口不带板卡长度，物理尺寸拿不准的故意缺省（遵循"绝不猜"）；加载即按类别 schema 校验，坏种子直接抛错；
- **检索**：`searchCatalog`（类别过滤 + 名称/别名大小写不敏感模糊匹配 + 条数上限）；`GET /api/catalog?category=cpu&q=9800`；
- **录入集成**：配件表单新增「从目录选择型号」下拉——点选自动带出型号与已核规格（`specToFormValues` 反向回填），来源记入条目 `source=catalog:{id}`，清单行显示「目录型号」标记；未选即手填，规格 §8.3 三档的最小实现；
- **测试**：目录 schema 全量校验 + 检索 6 用例；E2E +1（点选 → 字段回填 → 加入清单 → 来源标记）；全量 83 单元测试 + 9 条 E2E 全绿；
- **E2E 确定性加固**：新增 `scripts/reset-e2e-db.mjs`，Playwright 启动服务前重置 `data/e2e.db`，消除跨运行残留导致的恢复断言漂移；
- 浏览器实测：点选 9800X3D 后插槽 AM5 / TDP 120 自动带出。

### M18（2026-09-21）数据库迁移版本检测（本窗口）
`migrate.ts` 从"一大段幂等函数"重构为**版本化迁移**：
- `schema_version` 单行表（id=1, version, applied_at）；`MIGRATIONS` 数组按版本升序（v1 核心表 / v2 build_items 规格列 / v3 items_snapshot / v4 catalog_import_runs）；
- 只执行 `版本 > 当前` 的迁移；每步 `up()` 成功后才推进版本号——中途崩溃下次启动重跑同一步，因此**每个 up 必须保持幂等**（纪律写进文件头注释）；
- **降级拒绝**：数据库版本高于代码（回滚过代码）时拒绝迁移并不动 schema，console.warn 提示，避免旧代码写坏新库；
- 启动日志：每步迁移与最终版本均输出 `[rigmate-db]` 前缀日志（`npm run dev` 终端可见）；
- 无版本表的历史库自动从 v1 全量幂等跑一遍对齐（真实开发库已验证：用户数据无损，版本落 v4）；
- 测试 5 用例（全新库 / 幂等重跑 / 历史库升级含旧 socket 数据并入 / 只跑缺失步骤 / 降级拒绝）。

### M19（2026-09-21）BuildCores 目录导入器（本窗口）
按 ADR §8.1 六道工序实现（schema 校验→字段映射→缺字段缺省→来源与许可证记录→版本固定；大陆 SKU 适配留给人工种子）：
- **数据调研**：逐类读取上游 `schemas/*.schema.json` + 真实样本（socket 是 `LGA 1700` 带空格、主板板型 `Micro ATX`、PSU 连接器键小写 `pcie_12vhpwr`、CPU tdp/ppt 并存、PSU 只有 6+2pin 字段等差异全部按真实 schema 处理）；
- **导入器**（`src/infra/catalog-import/` + `scripts/import-buildcores.ts`）：离线读取本地克隆（不联网）；**上游 commit 是硬要求**（非 git 克隆必须 `--commit` 指定，否则拒绝导入）；`npm run import-catalog -- --source data/buildcores-open-db`；
- **产物 = 本地数据层**：`data/catalog/buildcores.json`（provenance + 26,121 条，gitignore 与 DB 同等对待——几万条生成数据不进 src/仓库）；运行时按需加载 + 进程内缓存 + 加载即校验（坏条目抛错）；
- **审计**：v4 迁移新增 `catalog_import_runs` 表（commit/许可证/计数/错误样本），每次导入一行；
- **字段映射**（`map.ts`，纯函数）：socket 剥空格大写（LGA 1700→LGA1700）、板型四档映射、M.2 PCIe→m2_nvme、6+2pin 计 8pin、12V-2x6 并入 16pin 计数、CPU tdp 优先 ppt 兜底、**水冷不带高度**（限高规则语义针对风冷）；缺字段一律故意缺省，绝不猜；
- **导入结果**：26,206 文件 → 26,121 条导入 / 85 跳过（无可映射规格，多为存储接口识别不了）/ **0 错误**；
- **UI 两处**（真实浏览器验证时发现的必要补充）：
  1. 目录署名行（ODC-By 要求随数据展示）：目录下拉下方安静小字「目录含 BuildCores OpenDB 导入 26121 条 · commit 4bbac3c · ODC-By 1.0（须保留署名）」；
  2. **目录关键词检索框**：导入万级条目后下拉前 30 条根本翻不到具体型号——新增检索输入（防抖 250ms 走 `q` 参数），空关键词回落种子+前 30；
- **修复表单校验 bug**：计数类字段（8pin/12VHPWR/M.2/SATA/x16 槽）此前按"正整数"校验，导入数据里"仅 12VHPWR 供电的显卡 8pin=0"是事实——`FieldDef` 新增 `count` 类型（非负整数），7 个字段改用，补 4 个单测（含 0 值往返）。


### M20（2026-09-21）目录批量录入工具·方案A：CSV 模板 + 导入命令（本窗口）
解决"国内型号无法不写代码就进目录"的录入瓶颈（用户明确反馈）：
- **模板生成**：`npm run catalog-template` → `data/catalog/人工目录模板.csv`（带 BOM，Excel 双击不乱码），**预填 49 行**来自 samples/目录收录候选.md 的型号清单——型号/类别/别名/确定字段直接填，没把握的字段留空（空 = 不带出，绝不猜）；
- **导入命令**：`npm run import-manual`——中文表头宽松解析（值写人话：mATX/AM5/NVMe 自动归一化）、逐行校验、**任何一行有问题整包拒绝并逐行报错**（数据用户可修，不放坏行）；同类别同名原地更新保留 id（可重复导入）；
- **产物与加载**：`data/catalog/manual.json`（本地数据层，gitignore）；运行时三层合并 **种子 → 人工 → BuildCores**（无关键词下拉里越靠前越相关）；加载即校验，坏条目抛错；
- **审计**：复用 catalog_import_runs（upstream_commit = "manual"）；
- 实测：49 条导入成功，检索「速虎」「无界」均命中人工条目，BuildCores 署名不受影响；
- 方案 B（网页目录管理页）留作后续"随手加"入口，数据通道已由 A 打通。

### M21（2026-09-21）全系统视觉母版（本窗口）
按用户要求"先出图、后开发"，为整个系统生成 12 张 SVG 视觉母版 + 同名开发注释（`docs/design/`）：
- **视觉系统文档** `00-visual-system.md`：tokens、语义五色、反模板规则、网格与断点；
- **F1 八板**：空项目 / 正常态（4 件已计价）/ 阻断诊断（R-GPU-CASE-001，336>320）/ 待补充主导（unknown 一等公民）/ 预算三态 / 过期+编辑+检查历史 / 报告页图纸风（规划）/ POST 检查仪式（规划）；
- **F2 三板**：行情台关注列表（新鲜度灯）/ 快照时间线（散点、无预测线）/ 证据台账（追加式可复核）；
- **F3 一板**：装机副驾（七事件卡、proposal 确认、LLM 降级态、解释标识）；
- **索引** `docs/design/README.md`：主线声明、画板索引、八条硬约束、开发对照；
- 生成脚本 `scripts/generate-visual-masters.py` 可复现；修复了 SVG font-family 属性引号转义导致的 XML 解析错误（12 张全部通过 minidom 校验）；
- 约定：**先改图再改代码**；后续每个页面的开发以对应母版为验收基线，改版后浏览器截图对照。

### M22（2026-09-22）系统布局第一步：导航壳 + 硬件中心（本窗口）
按 `docs/design/10-系统布局规划.md` 迁移路径第一步：
- **导航壳**：`src/ui/components/nav-shell.tsx`（client，usePathname 高亮），挂 `layout.tsx` 全局；四区 = 装机配置/硬件中心/方案库/证据台账，未实现区带"规划中"灰标并指向占位页；
- **占位页**：`/projects`、`/evidence`（静态，注明规划内容与文档出处）；
- **目录总览 API**：`GET /api/catalog/overview`——三层来源计数/导入时间/署名（纯组装逻辑在领域层 `domain/catalog/overview.ts`，2 单测）+ `listCatalogImportRuns`（审计表读取，仓储层新增）；
- **检索带来源标记**：`/api/catalog` entries 附 `source: seed|manual|buildcores`（非破坏性）；
- **硬件中心页** `/hardware`：来源三行（含 ODC-By 署名链）、类别覆盖矩阵（条目/有规格/按来源分列）、导入审计表、目录检索（与工作台共用 API，显示来源）；
- **实测发现并修正**：风魔 5060Ti 用 8pin 非 16pin（BuildCores 双条目）；FV160/U503/魔蛇为 mATX 系机箱（板型修正）；
- **E2E 新增** `tests/e2e/navigation.spec.ts`（导航四区可达 + 硬件中心渲染 + 检索命中人工条目含来源标记）；**118 单测 + 10 E2E 全绿**；浏览器截图验收（导航高亮/矩阵/署名正确）。
- **教训（重要）**：① E2E 与 dev server/构建同机并行会触发超时雪崩（4.3 分钟 vs 静默 29 秒），两个"假失败"由此而来——跑 E2E 前清场；② IAB（内置浏览器）click 管线在 /hardware 页出现定位超时的环境怪病，curl/E2E 均正常——以 E2E 为准。


### M23（2026-09-22）系统布局第三步：方案库 /projects（本窗口）
- **项目列表页**：`/projects`（client）——GET /api/builds（自带 items 与 budgetSummary，零新后端）；列 = 项目/用途/配件/预算/已计价/更新/打开，最近更新在前；空态与加载失败态各自成行；
- **打开 = 跨页直达**：工作台初始加载支持 `?project=<id>`（URLSearchParams），命中则载入该项目并提示"已从方案库打开"；无参数行为不变（恢复最近项目）；
- **导航**：方案库 ready（去灰标），证据台账仍占位；工作台 masthead 保持原样；
- **整机复核**：入口卡占位（V1-B，需自由文本解析器设计）；
- **E2E**：navigation.spec 更新（证据台账占位断言 + 新增方案库往返用例：工作台建项目加配件 → 列表出现 → 打开 → 工作台载入该项目）；**118 单测 + 11 E2E 全绿**；浏览器截图验收。
- 教训补记：E2E 自己写错类别未切换（CPU 页填额定功率）——测试失败先看快照里"页面长什么样"再改断言。


### M24（2026-09-23）报告导出 /builds/[id]/report（本窗口）
三步流"选配件 → 检测兼容 → 导出方案"的第三步闭环：
- **报告页**（client，零新后端——并行取 GET /api/builds/[id] 与 /check）：图框标题栏（RIGMATE · 装机方案检查报告 + 项目名/用途/检查时间/报告生成/结论状态含过期提示）→ 摘要数据行（配件/已计价/未计价/预算/余量，等宽）→ 装机清单规格表 → 兼容性诊断条款（按 阻断→待补充→警告→通过 分组，复用 finding-model 六要素）→ 数据与说明（可追溯声明/目录署名 ODC-By/不做价格建议）；
- **红线**：不压缩成单一总分（M21 板 07）；无检查时诚实输出"尚未运行兼容性检查"而非空报告；
- **入口**：工作台诊断区"查看报告 ↗"（有结果时出现）+ 方案库每行"报告"链接；
- **打印**：@media print 隐藏导航与操作条，白底，浏览器打印即 PDF；
- **E2E** report.spec 2 条（阻断条款上报告 + 未检查空态）；**118 单测 + 13 E2E 全绿**；浏览器截图验收（图框/清单/数据行正确）。

### M26（2026-09-23）证据台账 /evidence（本窗口）
价格证据的录入与台账（规格 §8.2，ADR §8.2）：
- **v5 迁移**：price_evidence 表（category/product_name/price_cents/price_basis/source_type/platform/shop/condition/evidence_url/note/captured_at/created_at）；LATEST_SCHEMA_VERSION = 5；
- **领域校验**：`domain/price/evidence.ts` priceEvidenceInputSchema——价格正整数、类别白名单、型号必填；sourceType 枚举 V1 仅 manual_entry/user_submission；
- **仓储**：price-evidence-repository——**追加式**（只 insert + 查询，无改删接口）；列表按 captured_at 倒序，支持类别/关键词过滤；
- **API**：GET/POST /api/evidence（POST 强制 sourceType=manual_entry，服务端 schema 校验逐字段报错）；
- **页面**：/evidence 替换占位——录入表单（类别/型号/价格/口径/渠道/店铺/成色/证据链接）+ 台账表（时间/类别/型号/价格/口径·渠道·店铺/成色/证据链接）+ 类别过滤按钮组；
- **E2E** evidence.spec 2 条（录入→台账可见→类别过滤；非法价格拒绝且不写库）；**126 单测 + 16 E2E 全绿**；浏览器验收（注意：改 migrate.ts 后 dev server 必须重启，否则新表不存在、页面报加载失败——本次实际踩到）。

### M27+M28（2026-09-23）产品方向重校准 + 目标驱动垂直切片（本窗口）
用户定向："产品应偏向 agent 系统——用户说'2 万白色海景房剪辑+游戏'就能自动搭配，兼容检查应自动进行而非让用户逐项填写"。执行分两步：

**M27 文档重校准（只改文档，不动代码）**：
- 业务规格升级 V2（产品定义/三种入口/DesignRequest-Proposal-Build 对象模型/Agent 事实边界/来源等级 verified_catalog·user_input·price_evidence·model_experience·unknown/最小追问原则/RAG 策略/验收主链路）；
- ADR §1/§6 重写（目标驱动入口、agent/tools/skills 目录规划、垂直切片先行、RAG 边界）；系统布局规划 v2（开始配置/我的方案/方案工作台/硬件资料/价格证据/高级 DIY 六区）；视觉母版改为"仪器白 / 方案工作台"（结果优先、渐进披露）；README 重写。

**M28 垂直切片（不依赖真实模型）**：
- **领域层**：`src/domain/design/intent.ts`（正则意图解析：预算"2 万/2w/8000"、用途 剪辑/游戏/开发/办公、外观 白色/海景房/静音/RGB、已有件、约束；信息不足返回 needs_input）+ `proposal.ts`（预算分档候选：<1.4万 9600X/4060/650W，1.4-2.3万 9800X3D/4070S/850W，≥2.3万 4090 档；按型号经验估算价格区间；预算位置写进取舍说明；runBuildChecks 自动校验）；
- **契约层**：`src/contracts/design.ts`（DesignRequest/StructuredIntent/DesignProposal/ProposalItem/AgentRun/AgentEvent 全 Zod，sourceLevel 五级，compatibilitySummary 四态 ok/attention/conflict/unknown）；
- **数据层**：v6 迁移五表（design_requests/design_proposals(含 accepted_build_id)/proposal_items/agent_runs/agent_events），design-repository 追加式保存运行与事件；
- **应用层**：`application/design/service.ts`——createDesignRequest（信息不足→追问态，不硬凑方案；正常→理解/检索/组合/校验/完成五段事件流）、acceptDesignProposal（幂等：重复接受返回同一 build；兼容冲突 409 拒绝，allowConflicts 仅供"自己调整配置"显式进入 DIY；接受后 createBuild+addBuildItem+checkBuild 自动跑检查+追加 accepted 事件）；
- **页面**：`/` 新首页（大输入框 FormData 原生提交——规避受控输入事件同步问题，预算可选，最近方案列表）；`/design/[id]` 审阅页（方案主视觉：预算区间/兼容四态/分项依据/需要确认项，Agent 活动流侧栏，依据折叠）；869 行旧工作台迁至 `/diy`，`?project=` 直达保留；导航壳改五区（开始配置/我的方案/高级 DIY/硬件资料/价格证据）；
- **E2E**：design.spec 2 条（主链路：输入→方案→接受→/diy 载入；信息不足→追问态）；diy-workbench/report/navigation 全部迁移到 /diy 或重写为新导航契约；**130 单测 + 17 E2E 全绿**；
- **踩坑**：① IAB（内置浏览器）对受控 textarea 的 fill/type 不触发 React 状态同步（DOM 有值但 state 不更新，按钮禁用）——E2E 真浏览器正常；改为 FormData 原生提交 + name 属性兜底，按钮仅 busy 时禁用；② IAB screenshot 命令超时 30s——以 E2E 为准（M22 已有同类记录）。

### M29（2026-09-23）自有规格库落库（本窗口）
用户定向："自己建一个数据库，把 8 大件的决策信息清洗整理存起来直接用；新品不是天天有，出了再录；不过度收集参数，用户想了解细节就给商品页链接（京东只链不爬）"。

- **v7 迁移**：`canonical_products` 表（id/类别/名称/别名 JSON/决策规格 JSON/来源/ref_url）+ 类别索引；加载与写入双端都过类别 Zod schema（坏数据不上线）。ADR §8.1 的四表拆分推迟到检索升级 SQL/FTS 时再做（当前进程内 substring 检索，拆表无消费方）。
- **仓储** `catalog-repository.ts`：upsert first-wins（种子→人工→BuildCores 顺序，同 id 先到先得，人工精选优先于批量）；**补缺更新** `mergeCatalogUpdates`——只填空位、绝不覆盖已核字段、refUrl 只在为空时写、目标 id 必须已存在（新品不允许外部数据源静默创建）；补丁值非法或键名不在 schema（疑似拼写错误）在门口整条拒绝。
- **运行时切换**：`loadSourcedCatalog()` 查库优先，库为空（未跑导入/全新 e2e 库）回退 JSON 三层合并，历史行为不变；`/api/catalog` 与方案生成服务已切换，entries 附带 refUrl。
- **入库 CLI**：`npm run catalog:db`（初始化，幂等可重跑，写 catalog_import_runs 审计）；`npm run catalog:db -- --update <file>`（ZOL 等补缺更新文件：{source, note, updates:[{id, specPatch, refUrl?, aliases?}]}，未命中 id 进报告走人工流程）。
- **商品页链接**：`src/ui/product-link.ts`——refUrl 优先，缺失时按型号拼京东搜索链接兜底；硬件中心检索结果的型号名与方案审阅页每个配件均带"商品页 ↗"。
- **数据红线修订**（业务规格 V2 §11.3 + 本文档 §9.4）：ZOL 等公开参数媒体允许离线限速导入决策字段（署名+时间+只补缺+不建新品）；电商平台绕反爬抓取继续禁止；价格不进规格库。
- **测试**：catalog-db.test.ts 6 条（first-wins/来源排序/补缺不覆盖/未命中与坏补丁拒绝/查库加载/写入校验）+ migrate 表清单；**136 单测全绿**。
- **UI 舒适度打磨（用户确认"不照搬 ZCode、借鉴 ai-elements"）**：首页目标输入加**起步示例条**（三条真实示例点击填入，借鉴 ai-elements 的 suggestion 模式）与生成中**步进指示器**（理解目标→检索目录→搭配方案，借鉴 loader 模式）；方案页加载态复用同一套 `.agent-progress` 语言。全部以 `--rm-*` token 手写实现，零新依赖，支持 prefers-reduced-motion。

### M30（2026-09-23）可插拔 LLM 意图解析（本窗口）
"模型只理解目标，事实仍归规则引擎"——LLM 的第一块正式职责：

- **适配器** `src/infra/llm/client.ts`：OpenAI 兼容 `/chat/completions`；`resolveLlmConfigFromEnv`（无 `RIGMATE_LLM_API_KEY` = 关闭）；`completeJson` 结构化输出（剥代码围栏 + Zod 校验，不合格按失败）；AbortController 超时（默认 12s）；失败不重试（快速降级优于等待）；错误信息永不含密钥。
- **LLM 意图解析** `src/application/design/intent-llm.ts`：中文提示词约束只回 JSON；输出 schema（budgetYuan/useCases/appearance/existingParts/constraints/region）；**表单显式预算优先于模型提取**；解析结果映射为 `StructuredIntent`（cents）。
- **编排接入**：`createDesignRequest` 异步化（API route 已 await）——配 key 走模型、失败/没配自动落回 `parseDesignIntent` 规则解析；活动流如实标注：`大模型（model）已解析预算、用途与偏好` / `大模型不可用（原因），已用本地规则理解目标` / `本地规则理解目标（未配置大模型）`；新增事实纪律事件 `候选、价格与兼容事实由本地目录和规则引擎核验，模型不参与事实判断`。
- **配置**：`.env.example` 新增 `RIGMATE_LLM_API_KEY / BASE_URL / MODEL / TIMEOUT_MS`（任何 OpenAI 兼容端点可用，含网关/中转）。
- **测试**：llm-client 9 条（配置默认值/剥围栏/服务报错/schema 拒绝/网络失败/超时中断/错误不含密钥）+ design-llm-intent 3 条（中文解析、显式预算优先、编造字段拒绝）+ design-service 2 条（无 LLM 全链路回归、接受幂等）；**150 单测全绿**。

### M31（2026-09-23）自然语言修订方案（本窗口）
"方案不是一次性产物，是持续对话的对象"——用户在方案页侧栏说调整要求，生成新版本并保留旧版：

- **规则式修订** `src/domain/design/revision.ts`：诚实边界明确——只处理两类最常见调整：**预算**（`parseBudgetRevision`：压到/控制在/改成 + 万/w/千/元；无单位仅认 ≥1000 的元值，"预算 1.5"这类歧义不猜）与**已有硬件**（"我已有电源"→ 该类别写回 existingParts）；识别不了的指令返回失败交上层如实告知。`existingPartCategories` 从描述推导排除类别（也供生成器使用）。
- **生成器支持排除**：`generateDesignProposal` 从 `intent.existingParts` 推导排除类别——已有硬件的类别不再生成购置候选，fitNotes 注明"已有硬件未计入购置清单，建议在高级 DIY 录入型号以参与兼容检查"。首次生成即生效（"已有电源"开头的目标不再推荐电源）。
- **LLM 修订** `reviseIntentWithLlm`：当前意图 JSON + 调整要求 → 改写后的完整意图（未提及字段由提示词约束保留）；输出同 schema 校验，不合格降级。
- **服务编排** `reviseDesign`：双轨理解（LLM 优先→规则兜底→都失败创建"追问"运行并保留原方案，说明当前能力边界）；成功则生成 version+1 新方案（仓储 `nextProposalVersion` / `markProposalsReplaced`，已接受版本不动），意图回写 `updateDesignRequestIntent`，自动重新校验。API：POST /api/design/[id]/revisions。
- **UI**：方案页侧栏"装机助手"新增调整输入框（.placeholder 示例：预算压到 1.8 万 / 我已有电源），反馈就近显示；追问消息同时出现在活动时间线与内联反馈。
- **测试**：design-revision 8 条（类别识别/预算解析含歧义拒绝/规则修订/诚实失败）+ design-llm-intent +2（LLM 修订改写保留、不合法输出降级）+ design-service +3（第 2 版与意图回写/无法理解保留原方案/已有硬件排除）+ design.spec +2 E2E（预算修订出第 2 版、无法理解诚实追问）；**162 单测 + 19 E2E 全绿**。踩坑：E2E 断言撞严格模式——追问消息在时间线与反馈区各渲染一次属预期，断言取 .first()。

### M32（2026-09-23）版本差异对比 + DIY 渐进披露（本窗口）
- **版本差异**：`domain/design/diff.ts` diffProposals（按类别对比相邻两版，未变化不出现；无上一版返回空——首版不把所有件当"新增"）；契约新增 `ProposalChange`（fromLabel/toLabel 可空），DesignResult 附 `changes`；仓储 `findPreviousProposal`（version 之下最近一版）；getDesignResult / reviseDesign 全部返回路径装配 diff。方案页 UI：第 N 版（N>1）且有变化时显示"相对第 N-1 版的变化"——`旧件(删除线) → 新件(加粗)`，新增/不再购置用文字标签。
- **DIY 渐进披露**：诊断区把 findings 拆为问题（阻断/待补充/警告）与通过两组——**有问题时**通过项折叠进 `<details>`（"通过 N 项 · 无需处理的结论已折叠"，点开查看）；**全部通过时**照常展开（干净结果不需要藏，也保住 E2E 对通过结论的断言语义）。计数章（阻断 N / 通过 N）始终完整可见。
- **测试**：design-diff 3 条（换件/移除与新增/首版为空）+ design-service 断言升级（跨档位修订 diff 含 4060、仅预算未跨档 diff 为空——"没变化就不造变化"、已有硬件 diff 标记不再购置）+ design.spec 修订用例升级（断言差异区含 4070 SUPER→RTX 4060）；**166 单测 + 19 E2E 全绿**。踩坑：diff 列表按 cpu→case 类别序，`.first()` 断言别假设显卡在前。

### M33（2026-09-24）产品化收口（本窗口）
- **检查历史时间线**：仓储 `listCheckRunSummaries`（最近 8 次检查的状态计数摘要，不带完整 findings）+ GET /api/builds/[id]/check/history + 服务 `getCheckHistory`；DIY 诊断区底部折叠区"检查历史 · N 次"（默认收起，时间 + 阻断/待补充/警告/通过计数），创建/切换/运行检查三处时机刷新；E2E 补断言（展开含"阻断 1"）。
- **品牌资产**：`src/app/icon.svg`（墨黑底 + 白色等宽 R + 仪器橙角标，Next 自动作 favicon）；删除 public/ 全部脚手架 SVG（file/globe/next/vercel/window），留 .gitkeep。
- **路由级状态页**：app/loading.tsx（quiet 步进指示）、error.tsx（重试 + 回首页，client）、not-found.tsx（回首页）；样式 .route-loading 体系。
- **部署准备**：Dockerfile（node:24-slim 两阶段，builder 含 better-sqlite3 原生编译工具链，VOLUME /app/data，RIGMATE_DB_PATH 指向卷）+ .dockerignore。**诚实注记：本机无 Docker 未实测构建，首次部署按需调试**。
- **真实浏览器视觉验收（8 状态，Playwright 截图人工比对）**：首页桌面/窄屏、方案 v1/v2-diff 桌面+窄屏、DIY 桌面/窄屏、方案库、404。**发现并修复真 bug：390px 窄屏导航文字竖排折行**（nav-shell 无移动端处理）——修复：导航允许换行平铺 + white-space: nowrap。
- **踩坑（环境非产品）**：临时脚本直接 playwright.launch 时页面客户端 fetch 挂起（SSR 正常、无 JS 错误、HMR ws 报 ERR_INVALID_HTTP_RESPONSE，疑与临时浏览器网络环境有关）；改用验证过的 Playwright Test 基建截图即正常——**视觉验收一律走 E2E 基建**。另：Git Bash curl 发中文 JSON 会 GBK 乱码（服务端正确收到乱码并诚实 needs_input），测试中文接口用 node fetch 或浏览器。

## 5. 代码地图

```text
src/
├─ app/                        # Next.js 页面与 API 路由（薄层，不写业务逻辑）
│  ├─ page.tsx                 # 目标入口首页（M28：自然语言输入 + 最近方案）
│  ├─ diy/page.tsx             # 高级 DIY 工作台（原逐项录入工作台整体迁移）
│  ├─ design/[id]/page.tsx     # 方案审阅工作台（M28：方案主视觉 + Agent 活动流）
│  ├─ api/design/…             # POST 创建目标 + GET 结果 + POST accept（幂等）
│  ├─ api/builds/…             # builds CRUD + items + check(GET=最近结果/POST=运行检查)
│  ├─ api/catalog/overview     # 硬件中心总览（M22）
│  ├─ hardware/ projects/ evidence/  # 资料区 + 方案库（含整机复核）+ 证据台账
├─ contracts/design.ts         # M28 共享 Zod 契约（请求/草稿/条目/运行/事件/兼容摘要）
├─ domain/                     # 纯业务逻辑，禁止依赖 DB/网络/模型
│  ├─ design/                  # M28：intent.ts（意图解析）+ proposal.ts（预算分档生成+自动校验）
│  ├─ build/                   # types/specs/fingerprint/budget（正式方案域，不变）
│  ├─ catalog/ + rules/        # 目录检索 + 12 条规则（作为 Agent 的后台工具复用）
│  └─ review/ price/           # M25 解析器 + 价格证据 schema
├─ application/
│  ├─ builds/service.ts        # 正式方案用例（接受草稿时复用）
│  └─ design/service.ts        # M28：目标→生成→审阅→接受 编排 + Agent 事件流
├─ infra/
│  ├─ catalog-import/          # 目录导入（BuildCores + 人工 CSV）
│  └─ db/                      # client + migrate(v6 五张 design 表) + repositories/(builds + design)
├─ ui/
│  ├─ category-form.ts finding-model.ts components/ canvas/   # 原有体系（/diy 与报告仍在用）
└─ (全局样式) app/globals.css  # 新增 home-page/design-page/proposal-item/agent-event 版式段
tests/                          # domain(49，含 design 4) + application(16) + ui(19) + infra(46) 单测
tests/e2e/                      # design(2) + diy-workbench(9) + navigation(2) + report(2) + evidence(2)
docs/                           # 业务规格 V2 / ADR / 布局规划 v2 / 视觉母版 / 本文档
```

## 6. 如何验证

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit（strict）
npm test            # Vitest，130 个单元测试
npm run build       # Next.js 生产构建（含类型检查）
npm run test:e2e    # Playwright，17 条端到端（独立端口 3100 + 每次运行前重置 data/e2e.db + 独立构建目录 .next-e2e；⚠️ 静默机器上跑，见 §0）
```

全部通过才算完成。**Windows 环境注意**：Playwright 无头壳下载在本机超时过，E2E 用环境变量指定浏览器：`RIGMATE_E2E_EXECUTABLE_PATH='C:/Users/25128/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'`（未设置时走 Playwright 默认浏览器，其他机器无需此变量）。

**数据库**：`data/rigmate.db`（已 gitignore）。表结构由 `migrateSchema` 版本化迁移自动创建（M18：schema_version 表，启动日志打印版本与每步迁移；数据库比代码新时拒绝迁移）。⚠️ 当前限制：dev server 运行中修改 `migrate.ts` 后，需重启 dev server 才会执行新迁移（迁移每进程只跑一次）。

**BuildCores 目录导入**（M19）：
```bash
git clone --depth 1 https://github.com/buildcores/buildcores-open-db.git data/buildcores-open-db
npm run import-catalog -- --source data/buildcores-open-db
# 产物 data/catalog/buildcores.json（gitignore），审计写入 catalog_import_runs 表；重启 dev server 后生效
```

**人工目录批量录入（M20）**：
```bash
npm run catalog-template   # 生成预填模板 data/catalog/人工目录模板.csv（49 行候选）
# 用 Excel 核对/补空（不确定留空），另存为「CSV UTF-8」
npm run import-manual      # 逐行校验，整包通过才写入；产物 data/catalog/manual.json
# 重启 dev server 后生效；目录三层合并：种子 → 人工 → BuildCores
```

## 7. 已知问题与技术债

1. **BIOS/CPU 支持规则（R-CPU-MB-002）未实现**——无可靠数据来源，规格 §9.3 允许；UI 已注明。
2. **配件编辑不允许改类别**（M14 有意设计：判别联合的 spec 结构依赖 category，改类别请删除后重加）；编辑/删除后旧结论正确标记过期。
3. **迁移无版本检测**——见上；计划加 schema_version 表 + 启动提示。
4. **历史项目无重命名**——同名项目现通过下拉中的"配件数 + 更新时间"区分（M8）；开发期测试数据已在 M8 清理；后续可考虑加重命名功能。
5. **切换项目后检查结果可恢复，但 findings 时间显示为绝对时间字符串**，排序用 ISO 比较已正确，无需处理——记录避免重复排查。
6. Playwright 配置 `workers: 1`（串行）——为保证"恢复最近项目"类测试的确定性，暂不改。
7. E2E 隔离已落地（M15）：独立端口/数据库/构建目录，不再污染开发库；`data/e2e.db` 会随运行增长，必要时手动删除即可。

## 8. 下一步计划（建议顺序）

长期路线的单一入口：`docs/superpowers/specs/2026-09-24-v2-product-design.md`。该文档定义最终产品、用户状态、事实链和 M34–M39 退出条件；每个阶段实施前另写小范围计划，依据上一阶段的真实反馈修订。

1. **M34 体验基线**：做可运行前端原型与页面状态系统。用户输入、方案结果、修订入口和硬件查询是主轴；审查所有产品文案，剔除内部说明。用真实浏览器评审桌面与手机关键状态。
2. **M35 工作台接线**：接真实接口，提供旧版方案只读浏览、来源入口、追问与失败恢复；保持现有 DIY/报告功能不回退。
3. **M36–M37 可信生成**：根据 20 份目标样本和访谈补国内高频目录，核查字段与来源；让 LLM 只从目录检索候选中提议组合，服务端验证并跑规则；保留规则式回退。
4. **M38–M39 产品化**：统一项目、DIY、报告与证据体验；Docker/目标环境部署实测、备份恢复、错误观测；邀请 5–10 名新手试用并修复高严重度问题。

## 9. 协同开发约定（与用户的约定，必须遵守）

1. **进度锚点习惯**：每完成一个大板块 → 更新本文档的"进度快照 / 里程碑 / 下一步"三节 → `git add -A && git commit -m "..." && git push`。这是用户明确要求的固定动作，不要遗漏。
2. **规格先行**：需求变更先更新业务规格文档（含版本记录），再改代码；代码与规格冲突时以规格为准并提醒用户。
3. **规则开发纪律**：每条规则必须覆盖四态测试（通过 / 冲突 / 缺字段 unknown / 边界相等值）；规则是纯函数，禁止读 DB、调模型、访问网络。
4. **数据红线（2026-09-23 修订，业务规格 V2 §11.3）**：自有规格库允许从公开参数媒体（ZOL 参数页等）**离线、限速导入决策字段**——必须署名来源+抓取时间，只允许"补缺"（绝不覆盖已核字段）、不允许静默创建新品；**继续禁止**绕过反爬/登录态抓取电商平台（京东只做搜索链接跳转，不抓取）；价格不进规格库，购买级证据仍走 manual_entry/user_submission，未来只接官方联盟 API 并落快照；无许可证数据集照禁。
5. **UI 修改必须真实验证**：改页面后用 Playwright E2E + 浏览器实际操作验证，不要只跑单元测试（历史上表单串台 bug 就是这样漏掉的）。
6. **新会话开工流程**：读本报告 → 读业务规格相关章节 → `git pull` → 开发 → 全量门禁 → 更新本报告 → push。

## 10. 环境备忘

- Windows 11 + Git Bash；Node v24；npm 11（本机另有 pnpm，项目统一用 npm）。
- 数据库路径环境变量 `RIGMATE_DB_PATH`（默认 `./data/rigmate.db`）；模板见 `.env.example`。
- 提交身份已配置：XyYpower / lilizhi134@gmail.com；远程认证走 gh CLI（keyring）。
- git 在 Windows 会提示 LF→CRLF 转换警告，无害，忽略即可。

## 11. 前端重写协同交接（2026-09-20 生效，重写落地前有效）

用户决定按 `docs/PC_DIY_装机助手_前端UI设计_v1.md` **重写前端**（另一 AI 窗口负责，已在 `src/ui/canvas/`、`tests/ui/canvas-layout.test.ts` 开工）。

### 文件冻结（本窗口严格遵守）
- 冻结：`src/app/page.tsx`、`src/app/globals.css`、`src/app/layout.tsx`、`src/ui/**`（theme.css / category-form.ts / finding-model.ts / components/ / canvas/）。
- 重写窗口可自由重组上述文件；但 `src/domain/`、`src/application/`、`src/infra/`、`src/app/api/**` 是功能契约，改前先在本文档登记。

### 重写必须保留的功能契约（对应 6 条 E2E 与用户已验证的流程）
1. 创建项目（名称 + 用途）→ 自动保存并出现在历史下拉；
2. 八类配件录入：类别切换 + 每类动态规格字段 + 型号名；提交体 `{ category, label, spec }`；
3. 表单草稿按类别隔离（切换不清空；成功加入后仅清空该类别）；
4. 当前清单展示与"已录入/待补充"状态、"N / 8 类"计数语义；
5. 运行检查 → 按 阻断/待补充/警告/通过 计数与排序展示（六要素：conclusion/evidence/missingFields/suggestedAction/ruleId）；
6. 刷新后自动恢复最近项目 + 历史项目切换下拉 + 最近检查结果恢复 + 过期横幅；
7. 删除当前项目：两步确认，确认文案带项目名。

### E2E 依赖提示
`tests/e2e/diy-workbench.spec.ts` 用 accessible name（可见文字）定位元素，并断言特定文案（"X / 8 类"、finding 结论原文、过期横幅、删除确认等）。重写后优先保留语义名称；若设计必须改文案，**同步更新 E2E**，完成后 `npm run test:e2e` 全绿才算交付；视觉验收按 UI 设计文档执行。

### 窗口分工现状（2026-09-20 更新：冻结解除）
- 前端重写已由原窗口完成并交接（M9-M12），**前端所有权移交本窗口**，文件冻结解除；
- 本窗口现负责前后端全栈开发；如再开新并行窗口，沿用 §11 的冻结/契约登记流程。

---

**版本记录**
- 2026-09-24 v3.13：M33 产品化收口——检查历史时间线（仓储摘要 + /check/history + DIY 折叠区）+ 品牌 favicon（icon.svg，脚手架 SVG 清理）+ 路由级 loading/error/404 + Dockerfile/.dockerignore（未实测，注记诚实）+ 8 状态截图视觉验收（修复窄屏导航竖排折行真 bug）；166 单测 + 19 E2E。
- 2026-09-23 v3.12：M32 版本差异对比 + DIY 渐进披露——diffProposals 按类别对比相邻版本（无上一版返回空）+ DesignResult.changes 全路径装配 + 方案页"相对上一版的变化"区（换件/新增/不再购置）+ DIY 诊断通过项折叠（问题存在时收起、全通过时展开）；166 单测 + 19 E2E。
- 2026-09-23 v3.11：M31 自然语言修订方案上线——规则式修订（预算/已有硬件两类，歧义不猜）+ LLM 修订（改写完整意图）+ 双轨降级 + 诚实追问 + 方案版本化（version 递增/旧版标记 replaced）+ 生成器支持排除已有硬件类别 + 方案页侧栏调整输入；162 单测 + 19 E2E。
- 2026-09-23 v3.10：M30 可插拔 LLM 意图解析上线——src/infra/llm OpenAI 兼容适配器（结构化输出+超时+无 key 关闭）+ LLM 意图解析（显式预算优先、Zod 校验、失败降级规则解析）+ createDesignRequest 异步化 + 活动流如实标注理解模式与事实纪律；150 单测 + 17 E2E。
- 2026-09-23 v3.9.1：UI 舒适度打磨——首页起步示例条 + 生成中步进指示器 + 方案页加载态（借鉴 Vercel ai-elements 模式，仪器白 token 实现，零依赖）；136 单测 + 17 E2E。
- 2026-09-23 v3.9：M29 自有规格库落库——v7 迁移 canonical_products 表 + 仓储（first-wins 入库/补缺更新只填空位/双端 schema 校验）+ `npm run catalog:db` 初始化与 --update 补缺 CLI + 运行时查库优先/JSON 兜底 + 商品页链接（refUrl + 京东搜索兜底，只链不爬）+ 数据红线修订（ZOL 参数离线导入允许）；评估并否决整体套用 zai-org/ZCode（ADR §3.6），M30 组件候选锁定 Vercel ai-elements（Apache-2.0）；136 单测。
- 2026-09-23 v3.8：M27 产品方向重校准 + M28 目标驱动垂直切片上线——业务规格 V2 / 布局规划 v2 / 视觉母版重写（文档层）；`/` 自然语言目标入口 + `/design/[id]` 审阅工作台 + v6 迁移五表（design_requests/proposals/items/agent_runs/events）+ 意图解析与预算分档生成（规则式，LLM 未接，界面如实标注"经验估算/本地目录按档位挑选"）+ 接受幂等与冲突 409 + 旧工作台迁 `/diy`；修复 IAB 受控输入不同步（FormData 原生提交兜底）；130 单测 + 17 E2E。
- 2026-09-23 v3.7：M26 证据台账上线——v5 迁移 price_evidence 追加式价格快照表 + 领域 schema + 仓储（只增不改）+ GET/POST /api/evidence + /evidence 页（录入表单/台账表/类别过滤，导航转正）；126 单测 + 16 E2E。踩坑重申：改 migrate.ts 后必须重启 dev server。
- 2026-09-23 v3.6：M25 整机复核上线——方案库粘贴配置单（解析器 parse.ts：类别关键词识别/型号名提取/行尾价格提取含千分位与¥、赠品服务行硬跳过、未识别行交用户手动归类）+ 逐行目录候选确认（modelTokenOf 检索，选中带规格并标记来源）+ 一键建项目跑检查跳报告；6 解析器单测用真实样本行回归；124 单测 + 14 E2E。
- 2026-09-23 v3.5：报告页检修打磨（用户反馈）——清单表"型号/关键规格"列名实相符（复用 CATEGORY_META.summary 带出人话规格，空规格弱化标注"规格待补充"）；诊断条款分级呈现：阻断/警告保留完整六要素卡，待补充/通过降为一行式紧凑条款（规则号+具体行动/结论），报告从重复卡片墙变成可扫读文档。
- 2026-09-23 v3.4：M24 报告导出上线——/builds/[id]/report（图框标题栏/摘要数据行/清单规格表/按状态分组诊断条款/数据说明；@media print 打印 PDF；不做总分红线落实）；入口 = 工作台"查看报告↗" + 方案库"报告"链接；report.spec 2 条；118 单测 + 13 E2E。
- 2026-09-22 v3.3：M23 方案库 /projects 上线——项目列表（名称/用途/配件/预算/已计价/更新/打开）、工作台 ?project=id 直达、整机复核入口占位；E2E 新增方案库往返用例；118 单测 + 11 E2E。
- 2026-09-22 v3.2：硬件中心视觉打磨（用户反馈：繁琐/表格不对齐/小字太多）——来源改数字条（34/49/26,121 大号等宽），覆盖表 6 列并 4 列（数字右对齐+表头同向+来源构成紧凑三元"6·0·789"+规格覆盖细条百分比），检索规格列从 JSON 换 CATEGORY_META.summary 人话摘要，导入审计默认折叠，hint 小字全删；E2E 断言"规格列不含 JSON"。设计原则：数据页数字立起来、说明只给一次、结果给人看。
- 2026-09-22 v3.1：M22 系统布局第一步上线——全局导航壳 + /hardware 硬件中心（三层来源计数/类别覆盖矩阵/导入审计/带来源检索）+ /projects、/evidence 占位页 + GET /api/catalog/overview；新增 navigation E2E；118 单测 + 10 E2E。记录 E2E 静默机器纪律与 IAB click 环境怪病。
- 2026-09-22 v3.0：UI 总纲落地——用户参考图评价后制定《系统布局规划》（docs/design/10-系统布局规划.md）：四区导航 + 三步主流程 + 画布复活条件 + 副驾抽屉定位与红线 + 增量迁移五步；清理 nul 垃圾文件，M21 index.html 收编。
- 2026-09-21 v2.12：M21 全系统视觉母版（12 张 SVG + 索引 + 生成脚本；F1 现状规范 8 板 / F2 规划 3 板 / F3 规划 1 板）。
- 2026-09-21 v2.11：人工目录规格查证第一批——BuildCores 交叉核验（XT M3 430/175、O11 VC 408/167+E-ATX、雪豹 249、风魔 208+8pin 修正、B650M K 槽4/x16槽1）+ ZOL/官网参数（S980 400/160、X400 427/176、VK03-M 410/167、FV160 380待复核）；板型修正（FV160/U503/魔蛇=mATX系）。剩余字段（A60高度、EAGLE ICE/火神/魔鹰板长、4款主板槽数、8款电源16pin、3机箱限长限高）因搜索配额 2026-09-28 重置待补查；模板来源注释已标注逐项出处。
- 2026-09-21 v2.10：修复"加入清单没反应"反馈缺陷——操作消息原渲染在页面最底端 footer（校验错误/成功提示用户看不见，用户报告加不成功；排查确认服务端均 201 成功，纯反馈可见性问题）。消息移至表单按钮正下方内联显示（form-feedback），footer 移除消息渲染；E2E 全绿（116 单测 + 9 E2E）。
- 2026-09-21 v2.9：M20 目录批量录入工具方案A（CSV 中文表头模板预填 49 条 + import-manual 命令，宽松归一化/逐行校验整包拒绝/三层合并 种子→人工→BuildCores；116 单测 + 9 E2E）。
- 2026-09-21 v2.8：样本 8→11 份；采纳用户对样本偏差的判断（整机单回避一线配置），收录候选名单增加偏差警示与"整机10+自购10"采集配比，README 同步；新增型号：技嘉 B840M FORCE（首个 B840 入门芯片组样本）、RX 9070 GRE 魔鹰（首个 A 卡样本）、瓦尔基里 GLA360/VK03-M、骨伽 VTE X2 铜牌（缩水典型）等。
- 2026-09-21 v2.7：样本收集 2→8 份（用户收集的 6 张主流电商配置单转录入库，全部录入系统跑检查）；产出国内目录第一批收录候选名单（samples/目录收录候选.md，≈35 条，按样本频次排序）；实证两条录入纪律：候选假阳性（P750GS→Phanteks）必须人工整名确认、无显卡配置的诚实处理（R-PSU-001 报"未添加显卡"）。
- 2026-09-21 v2.6：导入映射修正（真实配置单检验发现：上游 m2_slots 按尺寸展开不可映射、SATA 全零视为未填写）+ 首批 2 份真实配置单样本（samples/，已录入跑通第一轮检查：直播单 6通过/6待补充，抖音整机单 5通过/7待补充）。
- 2026-09-21 v2.5：M19 BuildCores 目录导入器（26,121 条离线导入 + commit 固定 + ODC-By 署名展示 + 审计表 + 目录检索框 + 表单 count 校验修复；107 单测 + 9 E2E）。
- 2026-09-21 v2.4：M18 数据库迁移版本检测（schema_version + 版本化迁移 + 启动日志 + 降级拒绝）。
- 2026-09-20 v2.3：换窗口交接快照（§0）——状态沉淀与接手指引；头部阶段更新为 90%。
- 2026-09-20 v2.2：M17 标准型号目录 v1（34 条种子 + 检索 API + 点选带出 + 来源标记；83 单测 + 9 E2E）+ E2E 运行前重置隔离库。
- 2026-09-20 v2.1：M16 版式 v3「技术规格单」「技术规格单」去 AI 味重构（去卡片/去英文小标签/等宽数字/报告式诊断条款）。
- 2026-09-20 v2.0：M15 版式 v2「仪器台」重做 + E2E 隔离（独立端口/库/构建目录）；开发库测试数据已清理。
- 2026-09-20 v1.9：M14 配件编辑/删除（PATCH/DELETE + 编辑态表单 + 两步确认；77 单测 + 8 E2E）。
- 2026-09-20 v1.8：M13 仪器白主题 + 预算余量计 + 价格/预算录入（E2E 7/7）；§11 冻结解除，前端所有权移交本窗口。
- 2026-09-20 v1.7：M12 尺寸核对示意下架（引擎留库休眠，复活条件 = 标准型号目录上线）。
- 2026-09-20 v1.6：M10 预算后端契约补记（priceCents + budgetSummary，73 测试全绿）；进度快照/§6/§8 同步。
- 2026-09-20 v1.5：M11 WebGL 氛围背景（用户原意的"3D 感"）+ 机器画布降级为尺寸核对示意；补回 §5 标题。
- 2026-09-20 v1.4：M9 前端重写落地（三栏装机台/深色主题/机器画布，§11 契约全保留，E2E 全绿）。
- 2026-09-20 v1.3：前端重写启动——文件冻结与功能契约交接（§11）；本窗口暂停前端文件。
- 2026-09-20 v1.2：新增 M8（删除体验修复 + 历史可辨识 + 测试数据清理）；§6 测试数更正为 58。
- 2026-09-20 v1.1：M7 UI F1 铺底（语义 tokens + 六要素诊断卡，未接线）；代码地图与下一步同步。
- 2026-09-20 v1：首份协同报告，覆盖 Phase 0 → M6 全部里程碑（AI 记录）。
