# RigMate UI 重构详细实施计划

目标：按设计基线将 RigMate 改造成参考图风格的三栏装机工作台。

架构：新增共享 WorkbenchShell 与右侧上下文组件，页面继续消费现有 API 和领域契约。迁移顺序为壳、首页、方案页、DIY、资料页、验收；每阶段保留旧路由和错误处理。

## Task 1：共享视觉 token

文件：src/ui/theme.css、src/app/globals.css、src/ui/workbench/types.ts。

- [ ] 定义浅灰白背景、白色面板、蓝灰文字、仪器橙、语义状态色、圆角、阴影和断点 token。
- [ ] 定义 WorkspaceStatus、AgentEvent、RequirementSummary、DiagnosticItem 类型。
- [ ] 保留旧 rm 变量作为兼容别名。
- [ ] 运行 npm run typecheck 和 npm run lint，提交 feat: add reference-based UI tokens。

## Task 2：三栏壳和左侧导航

文件：新增 src/ui/workbench/workbench-shell.tsx、brand-sidebar.tsx、workspace-header.tsx；修改 src/ui/components/nav-shell.tsx、src/app/layout.tsx、src/ui/v2-workspace.css。

- [ ] 实现 220px 左栏、主区自适应、340px 右栏。
- [ ] 导航顺序为开始配置、装机方案、硬件资料、我的方案、高级 DIY、证据台账。
- [ ] 当前项使用浅橙底、橙色图标和右侧短竖线。
- [ ] 900px 以下左栏变顶部菜单，右栏移到主区后。
- [ ] 检查首页和项目页路由，提交 feat: add RigMate three-column shell。

## Task 3：首页按参考图重做

文件：src/app/page.tsx、src/ui/v2-workspace.css、新增 tests/e2e/home-workbench.spec.ts。

- [ ] 保留 POST /api/design、预算校验、错误反馈和跳转逻辑。
- [ ] 中区重做标题、自然语言输入、预算快捷设置、示例目标和主按钮。
- [ ] 右栏显示 Agent 处理流程和最近方案/目标摘要。
- [ ] 增加从已有配置单开始和进入高级 DIY 次级入口。
- [ ] E2E 覆盖有效提交跳转和非法预算不发请求。
- [ ] 运行 npx playwright test tests/e2e/home-workbench.spec.ts，提交 feat: redesign goal intake page。

## Task 4：方案页按第一张图重做

文件：src/app/design/[id]/page.tsx；新增 AgentProgressCard、RequirementCard、BuildSummaryCard、BuildPartsTable、DecisionBanner、StatusBadge；修改样式和 tests/e2e/design.spec.ts。

- [ ] 保留版本选择、差异计算、修订、接受方案和异常分支。
- [ ] 中区显示摘要卡、预计总价、预算区间和八类配置清单，固定部件、型号、数量、价格、详情列。
- [ ] 右栏显示 Agent 时间线、需求摘要和待确认事项。
- [ ] 冲突、待补充、通过使用 StatusBadge，依据放入 details。
- [ ] 主按钮为接受这一版，次按钮为继续调整和进入高级 DIY。
- [ ] E2E 覆盖历史版本、修订和接受跳转，提交 feat: redesign design review workbench。

## Task 5：DIY 页按第二张图重做

文件：src/app/diy/page.tsx；新增 CompatibilityPanel；修改样式和 tests/e2e/diy-workbench.spec.ts。

- [ ] 保留八类硬件编辑、目录选择、价格输入、保存和检查 API。
- [ ] 左侧子导航使用 CPU、主板、显卡、内存、存储、电源、散热器、机箱。
- [ ] 中区显示当前规格编辑和机箱/显卡尺寸预览。
- [ ] 右栏显示阻断、待补充、通过诊断，默认折叠详细依据。
- [ ] 底部显示检查历史、通过数、阻断数和保存修改。
- [ ] 运行 DIY E2E，提交 feat: redesign DIY compatibility workbench。

## Task 6：迁移项目、硬件和证据页面

文件：src/app/projects/page.tsx、src/app/hardware/page.tsx、src/app/evidence/page.tsx、src/app/builds/[id]/report/page.tsx、src/ui/v2-workspace.css。

- [ ] 所有页面接入相同导航、背景、按钮和状态组件。
- [ ] 项目页按生成中、待确认、可继续 DIY、已完成分组。
- [ ] 保留目录来源、价格证据和检查报告。
- [ ] 运行 navigation、evidence、report E2E，提交 feat: align supporting pages with workbench UI。

## Task 7：响应式和视觉验收

文件：新增 tests/e2e/responsive-workbench.spec.ts；修改样式。

- [ ] 检查 1440×900、1280×800、390×844、768×1024。
- [ ] 断言 document.documentElement.scrollWidth 不超过窗口宽度。
- [ ] 检查长型号、价格列、按钮、诊断文本不溢出。
- [ ] 检查键盘焦点、表单标签、状态文字和减少动效。
- [ ] 运行 npm run typecheck、npm run lint、npm test、npm run test:e2e、npm run build。

## Task 8：交接给 Agent 后端开发

文件：src/contracts/design.ts、src/application/design/service.ts、src/application/design/intent-llm.ts、docs/superpowers/plans/2026-09-28-rigmate-agent-followup.md。

- [ ] 确认 Agent 事件、需求摘要、诊断状态和证据引用都能结构化返回。
- [ ] 精确规格、价格、尺寸、兼容性继续由目录、证据和规则引擎提供。
- [ ] 缺失字段显式使用 null 或 unknown，不让组件猜测。
- [ ] UI 验收完成后再开始 Agent 编排替换。

完成定义：主要页面共用参考图风格的三栏工作台；真实生成、修订、接受、DIY 保存与检查流程可用；桌面和移动端无横向滚动；全量检查通过；设计基线与实施计划可被另一位 AI 独立执行。
