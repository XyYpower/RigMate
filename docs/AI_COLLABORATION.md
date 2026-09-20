# RigMate AI 协同开发报告

> **本文档的用途**：AI 协同开发的"进度锚点"。每完成一个大的功能板块，AI 必须更新本文档（进度快照、里程碑、下一步），然后 git 提交推送——这是与用户约定的固定动作。
> **任何新会话 / 协作者，开工前先完整读完本文档，再按需读第 2 节的文档，不要凭猜测继续开发。**
>
> 最后更新：2026-09-20 ｜ 当前阶段：V1-A（DIY 清单检查闭环）已完成约 70% ｜ UI F1 铺底已完成（见 M7）
> 仓库：<https://github.com/XyYpower/RigMate>（main 分支）｜ 本地：`D:\XyyWork\RigMate`

---

## 1. 一分钟了解项目

- **产品定位**：面向中国大陆 DIY 装机/升级用户的配件清单检查工具。核心是"先确认能装，再决定买什么"。
- **核心理念**：确定性规则 + 可追溯证据；缺数据时诚实输出"待补充/未知"，**绝不猜默认值**。
- **明确不做**（红线，见业务规格 §3.2）：全网实时比价、电商爬虫、自动下单、价格预测、多 Agent 宣传、未经授权的数据集。
- **技术形态**：Next.js 16 + React 19 + TypeScript 模块化单体；SQLite（WAL 模式）+ Drizzle ORM；Vitest + Playwright。
- **当前状态**：V1-A 核心闭环已跑通并全部验证通过，处于本地可用工具阶段，尚未部署公网、无用户验证数据。

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
| UI F1 铺底：语义状态 tokens + 六要素诊断卡组件（纯增量，未接线 page.tsx） | ✅ 完成 |
| 预算字段与价格手动录入 | ⬜ **下一步** |
| 标准型号目录（种子数据 + 点选替代手填 + 型号候选确认） | ⬜ |
| 配件条目编辑 / 删除（当前只能追加） | ⬜ |
| 数据库迁移版本检测（当前改表结构需重启 dev server） | ⬜ |
| BuildCores 目录导入器（可审计、ODC-By 署名） | ⬜ V1-A 末 |
| 业务验证：20 份真实清单样本 + 5-10 名用户访谈 | ⬜ 业务侧，不阻塞开发 |
| V1-B：价格证据链 / 替代方案 / 报告导出 | ⬜ |
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

## 5. 代码地图

```text
src/
├─ app/                        # Next.js 页面与 API 路由（薄层，不写业务逻辑）
│  ├─ page.tsx                 # DIY 工作台（唯一页面，客户端组件）
│  └─ api/builds/…             # builds CRUD + items + check(GET=最近结果/POST=运行检查)
├─ domain/                     # 纯业务逻辑，禁止依赖 DB/网络/模型
│  ├─ build/types.ts           # 领域类型 + 输入 schema（判别联合，按类别校验 spec）
│  ├─ build/specs.ts           # 八类配件规格 Zod schema
│  ├─ build/fingerprint.ts     # 清单指纹（过期判断用）
│  └─ rules/                   # engine.ts(注册表+排序) + helpers + 按领域的规则文件
├─ application/builds/service.ts  # 用例编排：createBuild/addBuildItem/checkBuild/getLatestCheck/deleteBuild
├─ infra/db/                   # client.ts(懒初始化单例) + migrate.ts(幂等迁移) + repositories/
├─ ui/
│  ├─ category-form.ts         # 八类表单元数据（字段定义/摘要/提交解析）
│  ├─ theme.css                # F1 设计 tokens（--rm-* 语义色/深色基底，globals.css 已引入）
│  ├─ finding-model.ts         # 结论状态映射 + 六要素视图模型（纯函数）
│  └─ components/              # StatusChip / EvidenceStamp / FindingCard（F1，未接线）
└─ contracts/                   # contracts 目前为空占位
tests/                          # domain(41) + application(10) + ui(7) 单元测试；e2e/(6 条 Playwright)
docs/                          # 业务规格 / 架构 ADR / UI 设计 / 本文档
scripts/migrate-db.ts          # 手动建表（一般不需要，服务首次访问自动建）
```

## 6. 如何验证

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit（strict）
npm test            # Vitest，58 个单元测试（domain 41 + application 10 + ui 7）
npm run build       # Next.js 生产构建（含类型检查）
npm run test:e2e    # Playwright，6 条端到端（自动拉起 dev server）
```

全部通过才算完成。**Windows 环境注意**：Playwright 无头壳下载在本机超时过，E2E 用环境变量指定浏览器：`RIGMATE_E2E_EXECUTABLE_PATH='C:/Users/25128/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'`（未设置时走 Playwright 默认浏览器，其他机器无需此变量）。

**数据库**：`data/rigmate.db`（已 gitignore）。表结构由 `migrateSchema` 幂等迁移自动创建。⚠️ 当前限制：dev server 运行中修改 `migrate.ts` 后，需重启 dev server 才会执行新迁移（迁移每进程只跑一次）。

## 7. 已知问题与技术债

1. **BIOS/CPU 支持规则（R-CPU-MB-002）未实现**——无可靠数据来源，规格 §9.3 允许；UI 已注明。
2. **配件只能追加，不能编辑/删除**——影响过期标记的实际效用（用户改错只能删项目重建）。
3. **迁移无版本检测**——见上；计划加 schema_version 表 + 启动提示。
4. **历史项目无重命名**——同名项目现通过下拉中的"配件数 + 更新时间"区分（M8）；开发期测试数据已在 M8 清理；后续可考虑加重命名功能。
5. **切换项目后检查结果可恢复，但 findings 时间显示为绝对时间字符串**，排序用 ISO 比较已正确，无需处理——记录避免重复排查。
6. Playwright 配置 `workers: 1`（串行）——为保证"恢复最近项目"类测试的确定性，暂不改。

## 8. 下一步计划（建议顺序）

1. **预算字段与价格手动录入**：项目加 `budgetCents`（已有字段）；条目加可选价格；报告加"已计价/未计价"汇总（业务规格 §10.1 五档口径）。
2. **标准型号目录 + 候选确认**：种子目录（人工维护高频型号）→ 录入时点选标准型号自动带出规格 → 模糊输入给候选列表由用户确认（规格 §8.3 三档：已确认/候选待确认/无法匹配）。
3. **配件编辑/删除**：补 `PATCH/DELETE /api/builds/[id]/items/[itemId]`；变更后触发旧结果过期（复用指纹机制）。
4. **迁移版本检测**：`schema_version` 表 + 迁移函数数组按版本执行 + 启动日志。
5. **BuildCores 导入器**：离线导入 + 记录上游 commit + ODC-By 署名展示（架构 ADR §8.1）。
6. **业务侧并行**：收集 20 份脱敏真实清单 + 访谈（决定首批目录收录与 V1-B 优先级）。
7. **UI F1 接线（三栏改造 + 语义色切换）**：tokens 与诊断卡组件已就绪（见 M7）；因"预算字段录入"（第 1 项）与 UI 接线都会修改 `page.tsx`，两个开发窗口需协调先后，避免同文件并行改动。接线顺带补齐六要素渲染（现页面丢字段，见 M7 说明）。

## 9. 协同开发约定（与用户的约定，必须遵守）

1. **进度锚点习惯**：每完成一个大板块 → 更新本文档的"进度快照 / 里程碑 / 下一步"三节 → `git add -A && git commit -m "..." && git push`。这是用户明确要求的固定动作，不要遗漏。
2. **规格先行**：需求变更先更新业务规格文档（含版本记录），再改代码；代码与规格冲突时以规格为准并提醒用户。
3. **规则开发纪律**：每条规则必须覆盖四态测试（通过 / 冲突 / 缺字段 unknown / 边界相等值）；规则是纯函数，禁止读 DB、调模型、访问网络。
4. **数据红线**：不使用电商爬虫、非授权接口、无许可证数据集；价格证据必须带来源和时间；联盟 API 仅限官方接口且必须落快照（规格 §11.6 / §14）。
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

### 窗口分工现状
- **前端重写窗口**：按设计文档重构 UI；
- **本窗口**：冻结前端文件；可承接的非冲突工作 = 预算字段的领域层/数据库/API（不碰 page.tsx），或等重写落地后接手预算 UI 接线。

---

**版本记录**
- 2026-09-20 v1.3：前端重写启动——文件冻结与功能契约交接（§11）；本窗口暂停前端文件。
- 2026-09-20 v1.2：新增 M8（删除体验修复 + 历史可辨识 + 测试数据清理）；§6 测试数更正为 58。
- 2026-09-20 v1.1：M7 UI F1 铺底（语义 tokens + 六要素诊断卡，未接线）；代码地图与下一步同步。
- 2026-09-20 v1：首份协同报告，覆盖 Phase 0 → M6 全部里程碑（AI 记录）。
