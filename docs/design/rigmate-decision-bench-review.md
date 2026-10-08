# RigMate 装机决策台 UI 重置 · 视觉验收记录

> 日期：2026-10-08 · 分支：`feat/decision-bench-ui` · 依据：`docs/superpowers/plans/2026-10-08-rigmate-decision-bench-ui.md`
> 数据口径：全部截图来自真实 API（`POST /api/design`，输入「2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏」），无演示型号冒充正式结果。

## 截图（三档视口）

| 视口 | 首页 | 方案页 |
|---|---|---|
| 1440×1000 | [home-1440.png](./review/2026-10-08-decision-bench/home-1440.png) | [design-1440.png](./review/2026-10-08-decision-bench/design-1440.png) |
| 1024×1000 | [home-1024.png](./review/2026-10-08-decision-bench/home-1024.png) | [design-1024.png](./review/2026-10-08-decision-bench/design-1024.png) |
| 390×844 | [home-390.png](./review/2026-10-08-decision-bench/home-390.png) | [design-390.png](./review/2026-10-08-decision-bench/design-390.png) |

## 通过项

- **三件套三档可见**：AssemblyRail / BudgetRuler / VerificationDesk 在 1440 / 1024 / 390 全部可见（`responsive-workbench.spec.ts` 决策台三件套断言）。
- **无横向滚动**：`document.documentElement.scrollWidth <= window.innerWidth` 在全部页面 × 视口通过；装配轨道的横向滚动只发生在组件内部。
- **主按钮可聚焦可达**：首页「开始搭配」、方案页「接受这一版」均可聚焦；键盘从目标输入 → 预算 → 快捷档 → 主按钮一路 Tab 可达；核验台「看选择理由」可聚焦且点击后展开对应清单行。
- **reduced-motion**：`prefers-reduced-motion: reduce` 下首页与方案页内容直接呈现，不依赖动画。
- **状态诚实**：白色外观引起的 gpu / case「待确认」在槽位、清单核验列、核验台三处一致；`资料不足` 条目为中性/蓝灰样式，未显示为通过；价格一律「经验估算，非实时成交价」。
- **单橙主动作**：有待确认项时决策条持主按钮、底部「接受这一版」自动降级为次级；无待确认项时相反。

## 修复项（验收过程中发现并已修复）

1. 预算线右缘顶到标尺边框、「预算线」内嵌标签被裁切 → 移除内嵌标签，改用橙色「预算 ¥20,000」数字作为线的图例（文本替代仍由 aria-label + figures 双通道承担）。
2. 清单表型号过长时行内「待确认」徽章被一并截断 → 徽章移出截断区，固定渲染在型号之后。
3. 1024 视口顶栏预算摘要与版本选择器挤压 → 摘要加 ellipsis 截断。
4. 「最近的方案」在空库时整块消失 → 改为常驻面板 + 安静空态文案（符合 DESIGN.md §7 空态规则）。

## 已知限制

- **冲突态无法经 API 确定性到达**：`generateDesignProposal` 始终产出兼容组合，方案页的「冲突时接受禁用 + 核验台冲突条目 + 进入 DIY 修正」路径无法用 E2E 黑盒触发；该行为由单元层映射测试（`tests/ui/workbench-views.test.ts` conflict 排序）与 DIY 冲突 E2E（`diy-workbench.spec.ts`、`report.spec.ts`）共同覆盖，UI 侧 disabled 表达式为 `compatibility?.status === "conflict"`。
- 装配轨道在 ≤1440 桌面也需要组件内横滚才能看全 8 槽（340px 右栏挤压主区）；已按计划采用"组件内滚动、body 不滚"方案，滚动可达性由键盘/滚轮均可操作。
- 报告页（`/builds/[id]/report`）保留打印版式，仅通过全局导航统一视觉语言，未加 WorkspaceHeader（打印样式 `globals.css` 会隐藏页头）。
- 截图左下角的黑色圆点为 Next.js dev 指示器，非产品 UI。

## 门禁结果（2026-10-08）

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | ✅ |
| `npm run lint` | ✅ |
| `npm test` | ✅ 247 / 247（28 文件，含新增 workbench-views 14 例） |
| `npx playwright test` | ✅ 53 / 53 |
| `npm run build` | ✅ |
