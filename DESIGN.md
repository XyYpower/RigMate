# RigMate DESIGN.md

> **设计契约（单一事实源）**：本文件定义 RigMate 的视觉语言与组件规范。任何 AI 会话或开发者修改 UI 前**必须先读本文件**；新页面/组件与本文冲突时，先改本文再改代码。
> 视觉事实源：`docs/design/reference/plan-workbench.png`（方案工作台）、`docs/design/reference/diy-workbench.png`（高级 DIY）。
> 方法借鉴：[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)（MIT）；产品决策与红线见 `docs/superpowers/specs/2026-09-28-rigmate-ui-redesign.md`。
> 2026-09-28 定稿：替代旧"技术规格单"视觉体系（boards/ 已删除）。

## 1. Overview

RigMate 是 PC 装机与升级决策的 Agent 工作台。视觉基调：**明亮、精致、工程感的三栏工作台**——浅灰白画布上浮白色面板，仪器橙作为唯一主动作色引导用户下一步，绿/琥珀/红只表达真实状态。信息层级永远是：中间当前任务 > 右侧上下文（Agent 进度、需求、诊断）> 左侧导航。

不做：深色主题、渐变、玻璃拟态、卡片套卡片、工具日志墙、Agent 拟人形象、营销 hero。

## 2. Colors

### Brand & Accent
- **Accent（仪器橙）** `#f4581c`：唯一主动作色。用于主按钮背景、当前导航项（浅橙底 + 橙图标 + 右侧短竖线）、Agent 时间线节点、重点价格、决策条主按钮。
- **Accent Hover** `#e14e12`：主按钮悬停/按下加深。
- **Accent Soft** `#fdeee5`：当前导航项底色、推荐徽章底、决策条背景（约 8% 透明橙的实色近似）。

### Surface
- **Canvas** `#f4f5f6`：页面画布。浅灰白，刻意不纯白，让白面板浮起。
- **Surface（面板）** `#ffffff`：三栏中所有内容面板、顶栏、卡片。
- **Surface Subtle** `#f8f9fa`：面板内的表格斑马纹、代码/摘要底、子导航悬停底。
- **Hairline** `#e5e7eb`：面板边框、行分隔线。1px，统一全站。
- **Hairline Strong** `#d1d5db`：输入框边框、可点击分隔。

### Text
- **Ink** `#111827`：标题、正文主色（深蓝灰黑）。
- **Ink Muted** `#6b7280`：次级说明、表头、时间戳。
- **Ink Faint** `#9ca3af`：占位符、禁用文字。
- 数字、价格、版本、时间戳一律 `tabular-nums` 等宽数字。

### Semantic（只表达真实状态，禁止装饰性使用）
- **Pass 绿** `#16a34a`（底 `#ecfdf3`）：通过、可行、已确认。
- **Warn 琥珀** `#d97706`（底 `#fffaeb`）：待补充、待确认、取舍。
- **Block 红** `#dc2626`（底 `#fef3f2`）：兼容阻断、错误。
- **Info/Neutral** `#6b7280`（底 `#f3f4f6`）：unknown/资料不足。
- 状态呈现统一为 **StatusBadge**：色点/图标 + 状态词，禁止裸色块大面积铺底。

## 3. Typography

- **字体**：中文系统无衬线栈 `"Segoe UI", "Microsoft YaHei", system-ui, sans-serif`；数字/价格/型号用 `ui-monospace` 等宽 + `tabular-nums`。
- **层级**（桌面）：
  - 页面标题（方案名）：22-24px / 700
  - 区块标题（配置清单、兼容性诊断）：16px / 700，左侧配 3px 橙色竖条
  - 正文/表格：13-14px / 400-500
  - 辅助说明、表头：11-12px / 500-600
- 中文正文行高 1.6；表格单元格内不换行截断时用 ellipsis + title。

## 4. Layout

### 三栏工作台（≥1200px）
- **左导航 220px**：白底右侧发丝线；Logo + 副标题置顶；导航项 40px 高。
- **主区自适应**：页面内容面板化，面板间距 16px；面板内边距 20-24px。
- **右上下文栏 340px**：Agent 处理进度（上半）+ 你的需求/兼容性诊断（下半）；DIY 页下半为诊断，方案页下半为需求摘要 + 待确认。

### 顶部工作栏
方案标题 + 状态徽章在左；自然语言修订输入居中（最大 640px，橙主按钮内嵌右侧）；全局主动作在右。**顶栏只允许一个橙色主按钮。**

### 断点
- `≥1200px`：三栏。
- `900-1199px`：右栏并入主区底部（两栏）。
- `<900px`：左栏折叠为顶部横向菜单（可换行平铺，禁止文字竖排）；右栏内容按"主任务 → 上下文"顺序单列排列。所有主要按钮保持可达，**全站禁止横向滚动**。

## 5. Shapes & Elevation

- **圆角**：面板 12px；按钮/输入 8px；徽章/状态点 999px（pill）。
- **阴影**：默认无；悬浮面板 `0 1px 2px rgba(16,24,40,0.05)`；主按钮/时间线节点不用阴影。
- **发丝线优先**：结构关系用 1px `#e5e7eb` 表达，阴影只给"浮在画布上"的面板。

## 6. Components

### BrandSidebar（左导航）
Logo（22px 墨底方块 + "R"）+ "RigMate" + 副标题"PC 装机与升级 Agent 工作台"。导航顺序：**开始配置、装机方案、硬件资料、我的方案、高级 DIY、证据台账**。当前项：浅橙底 `--wb-accent-soft`、橙图标、右侧 3px 短竖线；非当前项灰字，悬停 Ink。

### WorkspaceHeader（顶栏）
见 §4。修订输入是第二入口（方案页），提交走 `POST /api/design/[id]/revisions`。

### AgentProgressCard（Agent 处理进度）
垂直时间线：完成=橙色实心圆+对勾、进行中=橙色描边空心、等待=灰描边。每步：标题 + 1-2 行说明 + HH:mm 时间戳。数据来自 `AgentEvent`，**不伪造分步动画**；同步生成只显示"已完成"态。

### BuildPartsTable（配置清单表）
固定列：部件（图标+类别）、型号、数量、参考价格、详情箭头。行高 44px、发丝线分行、悬停 `--wb-surface-subtle`。价格右对齐等宽。底部合计行加粗。

### DecisionBanner（决策条）
浅橙底横条：左侧 💡 图标 + "现在需要你决定" + 取舍说明；右侧最多两个动作按钮（橙主 + 白描边次）。数据来自 `decisionItems`。

### StatusBadge（状态徽章）
`色点 + 状态词`，语义色 §2。状态全集：loading / ready / attention / conflict / unknown / accepted / error。

### CompatibilityPanel（兼容性诊断，DIY 右栏）
按 **阻断 → 待补充 → 通过** 固定排序的卡片列表：状态徽章 + 结论标题 + 依据（折叠）+ 建议（橙色箭头引导动作）。通过项在存在问题时折叠为一行；全通过时照常展开。

### 按钮
- **Primary**：橙底白字，8px 圆角，13px/600，padding 9px 18px；hover `#e14e12`。
- **Secondary**：白底灰边（hairline-strong）Ink 字；hover 边框转橙。
- **Ghost/Text**：无边框，用于行内操作（改/删仍需就近确认）。
- 同屏主按钮唯一；破坏性动作红色文字 + 两步确认。

### 表单输入
白底、`hairline-strong` 边框、8px 圆角、focus 时橙色 2px outline（offset 0）。标签 12px/600 在输入上方。错误信息紧贴输入下方红色 12px，**不丢用户已输入内容**。

## 7. States

| 状态 | 呈现 |
|---|---|
| loading | 骨架屏或 quiet 步进指示（`.agent-step`），不伪造进度 |
| ready | 正常内容 + 主按钮"接受这一版" |
| attention（待确认） | DecisionBanner 优先于主按钮 |
| conflict（阻断） | 红 StatusBadge + 可执行建议；"接受"禁用，"进入 DIY 修正"可用 |
| unknown（资料不足） | 中性徽章 + 需要补充的具体字段 |
| error | error.tsx 模式：重试 + 回首页，不丢输入 |
| 空态 | 一行安静说明 + 一个入口按钮，不做图标虚线框 |

诚实红线：价格一律标注"经验估算/证据日期"；无依据字段显示"待补充"而不是猜值；规则式生成如实标注，不冒充 AI 智能搭配；演示数据不得接入正式接受/导出链路。

## 8. Motion

- 时长两档：**150ms**（hover/按下/颜色）与 **250ms**（面板展开、时间线节点点亮）。
- 步进指示呼吸动画 1.2s 交错；仅用于进行中状态。
- 全部动效尊重 `prefers-reduced-motion`（直接呈现终态）。

## 9. Voice（文案语气）

- 用户视角短句："现在需要你决定"、"已完成候选检索"；禁止开发者口吻（"规则引擎在线"、"模块接线"）。
- 每条状态给下一步动作；每条问题给依据入口（"查看依据"折叠）。
- 数字诚实：估算标估算，未知标待补充，失败标失败原因。
