# RigMate 装机决策台 UI 重置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将首页、方案页和共用工作台从通用 AI 工作台改造成以八类硬件装配、预算和证据核验为主叙事的 RigMate 装机决策台。

**Architecture:** 保留现有 API、domain、application 和数据库。新增 `AssemblyRail`、`BudgetRuler`、`VerificationDesk` 三个纯展示组件，由页面层把现有 `DesignProposal`、兼容摘要和 Agent 事件映射成视图数据。共享壳和 CSS token 先完成，再逐页接线；所有事实继续来自 API 和现有规则，不在 UI 中推断。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、现有 CSS token、Playwright、Vitest。

---

## 范围与不变项

本计划只修改 UI 展示、布局、文案和相关 E2E 选择器。不得修改设计请求、方案生成、接受、目录、证据、兼容规则或数据库 schema。以下行为必须保持：

- 首页提交目标仍调用 `POST /api/design` 并跳转 `/design/[id]`；
- 方案修订、历史版本切换和接受方案继续使用现有 API；
- partial、unknown、conflicting 不得在 UI 被显示为 verified 或 pass；
- `/diy`、`/hardware`、`/evidence`、报告页继续可访问；
- 页面不增加自由聊天主流程，不添加虚构硬件图片或实时价格。

## Task 1: 冻结共享视图契约与视觉 token

**Files:**
- Modify: `DESIGN.md`
- Modify: `src/ui/theme.css`
- Modify: `src/ui/workbench/types.ts`
- Modify: `tests/ui/finding-model.test.ts`（仅在新增状态映射测试需要时修改）

- [ ] **Step 1: 写出装配轨道和核验台的视图类型**

在 `src/ui/workbench/types.ts` 增加以下类型，保持组件不读取 URL、数据库或环境变量：

```ts
export type AssemblySlotState = "empty" | "retrieving" | "ready" | "attention" | "conflict" | "unknown";

export type AssemblySlot = {
  category: BuildItemCategory;
  label: string;
  model: string | null;
  state: AssemblySlotState;
  detail: string | null;
};

export type BudgetRulerView = {
  budgetCents: number | null;
  lowCents: number | null;
  highCents: number | null;
  midpointCents: number | null;
  state: "unknown" | "within" | "crossing" | "over";
};

export type VerificationDeskItem = {
  id: string;
  state: "conflict" | "attention" | "unknown" | "pass";
  title: string;
  impact: string;
  evidenceLabel: string | null;
  actionLabel: string | null;
};
```

- [ ] **Step 2: 添加新 token 并保留旧别名**

在 `src/ui/theme.css` 增加石墨结构色、铝灰槽位色、蓝灰资料色、轨道线和标尺线 token。现有 `--wb-*` 与 `--rm-*` 在迁移完成前保留，避免旧页面变成未定义颜色。新 token 使用固定十六进制值，不引入渐变文字或装饰性玻璃效果。

- [ ] **Step 3: 更新设计契约**

在 `DESIGN.md` 的导航、组件和页面章节补充 `AssemblyRail`、`BudgetRuler`、`VerificationDesk`，并将“六项导航”改成“三个主入口 + 场景入口”的新结构。保留状态颜色、可访问性、响应式和事实边界条款。

- [ ] **Step 4: 验证 token 和类型**

运行：

```bash
npm run typecheck
npm run lint
```

预期：通过，且没有 UI 组件引用不存在的 token 或类型。

## Task 2: 实现装配轨道、预算标尺和核验台

**Files:**
- Create: `src/ui/workbench/assembly-rail.tsx`
- Create: `src/ui/workbench/budget-ruler.tsx`
- Create: `src/ui/workbench/verification-desk.tsx`
- Modify: `src/ui/workbench/workbench.css`
- Modify: `src/ui/workbench/types.ts`
- Create: `tests/ui/workbench-views.test.ts`

- [ ] **Step 1: 写纯函数视图测试**

在 `tests/ui/workbench-views.test.ts` 覆盖：空目标生成 8 个 `empty` 槽位；方案项映射为对应类别和型号；`conflict`、`unknown`、`attention` 不被映射成 `ready`；预算无值显示 `unknown`；估算区间跨预算线显示 `crossing`；估算下限高于预算显示 `over`。

- [ ] **Step 2: 实现 `AssemblyRail`**

组件只接受 `slots: AssemblySlot[]` 和可选 `onSelect(category)`。每个槽位必须有可访问名称、类别文字、状态文字和详情入口。桌面横向排列，窄屏允许组件内部滚动；不得让页面 body 横向滚动。空槽位提供“等待目标”或“待补充”语义，不使用虚构硬件数据。

- [ ] **Step 3: 实现 `BudgetRuler`**

组件只接受 `BudgetRulerView`。显示预算范围、估算范围、当前中值和状态文字；无预算时显示“未设置预算”，不把 0 当成预算。标尺必须有文本替代，不能只依赖颜色或位置。

- [ ] **Step 4: 实现 `VerificationDesk`**

组件按 `conflict → attention → unknown → pass` 排序，显示影响、证据入口和动作按钮。没有 action 时不渲染空按钮。Agent 事件不在组件内部生成，只能作为折叠的“处理记录”插槽传入。

- [ ] **Step 5: 添加组件样式**

在 `workbench.css` 增加装配槽位、轨道线、预算标尺、核验台和键盘焦点样式。状态同时使用图形、文字和颜色；不使用 2px 以上彩色侧边条，不做重复的图标卡片网格。

- [ ] **Step 6: 运行组件测试**

运行：

```bash
npx vitest run tests/ui/workbench-views.test.ts
```

预期：全部通过。

## Task 3: 重做共用工作台壳和导航

**Files:**
- Modify: `src/ui/workbench/brand-sidebar.tsx`
- Modify: `src/ui/workbench/workspace-header.tsx`
- Modify: `src/ui/workbench/workbench-shell.tsx`
- Modify: `src/ui/workbench/workbench.css`
- Modify: `tests/e2e/navigation.spec.ts`

- [ ] **Step 1: 收缩主导航**

保留“开始配置”“我的方案”“硬件资料”三个主入口；高级 DIY 和证据台账改为场景入口，但仍可从已有路径访问。方案页和项目页的 active 状态必须保持可辨识。更新导航 aria-label 和链接名称，避免通过 CSS 隐藏仍被读屏器读取的重复链接。

- [ ] **Step 2: 重做品牌块**

保留 RigMate 名称，副标题改为用户能理解的“装机决策台”。Logo 使用现有字母标记，不引入远程图片。品牌块要在窄屏仍保持可读，导航在 `900px` 以下变为顶部可换行菜单。

- [ ] **Step 3: 简化 `WorkspaceHeader`**

顶栏只显示当前对象、状态、预算摘要和一个主动作插槽。方案修订输入移出顶栏，由方案页内容区承载；历史版本提示仍保留。保证 `StatusBadge` 有可读文本和 `aria-label`。

- [ ] **Step 4: 更新壳布局样式**

保持 `>=1200px` 三栏、`900–1199px` 两栏、`<900px` 单栏规则。为上下文栏增加语义标题“核验台”，并让主内容优先于上下文内容。禁止页面级横向滚动。

- [ ] **Step 5: 更新导航 E2E**

保留现有路由访问断言，增加三个主入口名称、方案页 active 状态和窄屏无横向滚动断言。运行：

```bash
npx playwright test tests/e2e/navigation.spec.ts tests/e2e/responsive-workbench.spec.ts
```

预期：通过。

## Task 4: 重做首页“开始组装”

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/ui/v2-workspace.css`
- Modify: `tests/e2e/home-workbench.spec.ts`
- Modify: `tests/e2e/responsive-workbench.spec.ts`

- [ ] **Step 1: 保留现有提交逻辑**

保持 `goal`、`budget`、非法预算反馈、快捷预算和 `POST /api/design` 不变，只调整 DOM 层级、文案和视图数据。输入提交后仍跳转到 `/design/[id]`。

- [ ] **Step 2: 接入空状态装配轨道**

首页首屏按“标题 → 八类空槽位 → 目标输入 → 预算 → 主按钮”排列。空槽位固定使用八类顺序，显示每类需要的关键信息，例如“显卡 / 用途和预算决定”。不得填入假型号或假价格。

- [ ] **Step 3: 接入预算标尺和结果承诺**

无方案时 `BudgetRuler` 显示空态，旁边显示三项真实能力：资料核验、兼容检查、可编辑方案。移除泛化的“RigMate 怎么工作”大卡片；最近方案和整机复核保留为次级入口。

- [ ] **Step 4: 更新生成中状态**

生成时只显示真实的等待状态和槽位状态，不显示伪造的百分比。错误时保留用户输入、显示就近错误文本和重试动作。

- [ ] **Step 5: 更新首页 E2E**

保留非法预算、快捷档提交和最近方案断言；新增八类槽位、预算标尺文本、主按钮可达和窄屏不横向滚动断言。运行：

```bash
npx playwright test tests/e2e/home-workbench.spec.ts tests/e2e/responsive-workbench.spec.ts
```

预期：通过。

## Task 5: 重做方案审阅页和核验台

**Files:**
- Modify: `src/app/design/[id]/page.tsx`
- Modify: `src/ui/workbench/build-summary-card.tsx`
- Modify: `src/ui/workbench/build-parts-table.tsx`
- Modify: `src/ui/workbench/agent-progress-card.tsx`
- Modify: `src/ui/workbench/requirement-card.tsx`
- Modify: `src/ui/workbench/decision-banner.tsx`
- Modify: `src/ui/v2-workspace.css`
- Modify: `tests/e2e/design.spec.ts`

- [ ] **Step 1: 添加页面视图映射**

在页面层从 `DesignProposal` 生成 `AssemblySlot[]`、`BudgetRulerView[]` 和 `VerificationDeskItem[]`。映射使用 proposal 的 compatibility、unknowns、confirmationRequired 和已有事件；不得从标签文本猜测质量或兼容状态。

- [ ] **Step 2: 调整首屏层级**

首屏顺序固定为方案标题和状态、预算标尺、方案摘要、配置清单、决策条。配置清单默认展开行级型号和状态，依据仍使用 details 按需展开。

- [ ] **Step 3: 更新 `BuildPartsTable`**

表头改为部件、型号、核验、参考价格、详情。数量列保留在桌面布局，窄屏变为行内信息。每行显示真实 `sourceLevel` 文案；`unknown` 和待确认字段必须可读。不要把所有行统一写成“已核目录型号”。

- [ ] **Step 4: 用核验台替换 Agent 主叙事**

右栏顶部渲染四阶段轨道和 `VerificationDesk`，`AgentProgressCard` 改为折叠的处理记录。保留真实事件和时间戳，删除泛化的“模型正在思考”类文案。

- [ ] **Step 5: 调整主动作和修订输入**

把自然语言修订输入移动到配置清单或决策条之后。方案页同屏只保留一个橙色主动作；冲突时接受按钮禁用，进入 DIY 仍可用；历史版本只读逻辑保持不变。

- [ ] **Step 6: 更新方案 E2E**

保留生成、接受、追问、修订、历史版本和单件依据断言；新增“核验台”“配置清单核验状态”“预算标尺”和冲突主动作断言。运行：

```bash
npx playwright test tests/e2e/design.spec.ts
```

预期：通过。

## Task 6: 迁移辅助页面到同一套视觉语言

**Files:**
- Modify: `src/app/diy/page.tsx`
- Modify: `src/app/hardware/page.tsx`
- Modify: `src/app/evidence/page.tsx`
- Modify: `src/app/projects/page.tsx`
- Modify: `src/app/builds/[id]/report/page.tsx`
- Modify: `src/ui/workbench/workbench.css`
- Modify: `tests/e2e/diy-workbench.spec.ts`
- Modify: `tests/e2e/catalog-quality.spec.ts`
- Modify: `tests/e2e/evidence.spec.ts`
- Modify: `tests/e2e/report.spec.ts`

- [ ] **Step 1: 统一页面壳和入口文案**

所有辅助页使用新的品牌导航、页面标题、状态徽章和主按钮。不要把装配轨道硬塞入报告或证据台账，保留各页面自己的任务结构。

- [ ] **Step 2: 统一来源与状态表达**

硬件页突出型号、缺失字段、质量状态和来源；证据页突出审核状态；DIY 和报告页沿用核验状态和诊断排序。任何页面都不得把 unknown、partial 或未审核证据显示为通过。

- [ ] **Step 3: 运行辅助页面 E2E**

运行：

```bash
npx playwright test tests/e2e/diy-workbench.spec.ts tests/e2e/catalog-quality.spec.ts tests/e2e/evidence.spec.ts tests/e2e/report.spec.ts
```

预期：既有业务断言通过，只更新必要的可访问名称和视觉选择器。

## Task 7: 浏览器视觉验收和发布门禁

**Files:**
- Modify: `tests/e2e/responsive-workbench.spec.ts`
- Create: `docs/design/rigmate-decision-bench-review.md`
- Modify: `docs/AI_COLLABORATION.md`

- [ ] **Step 1: 增加三档布局断言**

在 Playwright 中检查首页和方案页的 `AssemblyRail`、`BudgetRuler`、`VerificationDesk` 在 `1440x1000`、`1024x1000`、`390x844` 下可见，`document.documentElement.scrollWidth <= window.innerWidth`，主按钮可聚焦。

- [ ] **Step 2: 进行键盘和 reduced-motion 检查**

使用键盘从目标输入移动到预算、主按钮、装配槽位和核验动作；设置 `prefers-reduced-motion: reduce` 时不依赖动画才能看到内容。修复对比度和焦点问题。

- [ ] **Step 3: 写视觉验收记录**

在 `docs/design/rigmate-decision-bench-review.md` 记录三档截图路径、通过项、已知限制和修复项。记录必须使用真实 API 数据，不使用演示型号冒充正式结果。

- [ ] **Step 4: 运行完整门禁**

运行：

```bash
npm run typecheck
npm run lint
npm test
npx playwright test
npm run build
```

预期：全部通过；若 E2E 受 dev server 或测试数据库污染影响，先按 `docs/AI_COLLABORATION.md` 的静默机器和独立数据库规则清理环境后重跑。

- [ ] **Step 5: 更新协同进度**

在 `docs/AI_COLLABORATION.md` 增加 UI 重置版本、验收结果、未完成事项和下一步 M37 事实链工作，然后单独提交 UI 变更。

## 提交顺序

每个任务独立提交，建议使用以下提交主题：

1. `feat: define decision bench view contracts and tokens`
2. `feat: add assembly rail budget ruler and verification desk`
3. `feat: reshape rigmate workbench navigation`
4. `feat: redesign home as assembly bench`
5. `feat: redesign proposal review and verification desk`
6. `refactor: align supporting pages with decision bench language`
7. `test: verify decision bench responsive states`

实现完成后再使用 `finishing-a-development-branch` 决定是否合并或创建 PR；在此之前不要把 UI 重置和 M37 数据质量工作混在同一个提交中。
