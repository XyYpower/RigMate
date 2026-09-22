# RigMate 视觉母版索引（M21）

> 视觉事实源：`src/ui/theme.css`、`src/app/globals.css`、`src/ui/finding-model.ts`。
> 生成脚本：`scripts/generate-visual-masters.py`（改视觉先改脚本或 SVG，再同步代码）。
> 规则：**先改图，再改代码**；每完成一个页面，用浏览器截图对照对应母版验收。

## 主线

**仪器白 / 技术规格单**（用户 2026-09-20 定向，M13-M16 三轮迭代定型）。
旧 UI 设计文档 §8.1 的"深色硬件终端"已废弃为主线，仅保留为未来决策对比板。

## 画板索引

### F1（随 V1-A，已实现功能的规范板）

| 文件 | 内容 |
|---|---|
| `boards/f1/01-workbench-empty` | 空项目 / 创建入口 |
| `boards/f1/02-workbench-normal` | 清单 4 件 + 预算余量 46.8% + 待补充 |
| `boards/f1/03-workbench-block` | R-GPU-CASE-001 阻断（336 > 320）+ 超支 |
| `boards/f1/04-workbench-unknown` | unknown 一等公民：虚线幽灵 + 未计价斜纹 |
| `boards/f1/05-budget-states` | 预算三态并列：无预算 / 有余量 / 超支 |
| `boards/f1/06-stale-edit-delete` | 过期横幅 + 编辑态橙线 + 检查历史 |
| `boards/f1/07-report-blueprint` | 报告页（规划参考，路由未实现） |
| `boards/f1/08-check-ritual` | POST 检查序列关键帧（规划参考） |

### F2（随 V1-B 行情台，规划参考）

| 文件 | 内容 |
|---|---|
| `boards/f2/markets-watchlist` | 关注列表 + 新鲜度灯 |
| `boards/f2/snapshot-timeline` | 价格散点时间线（无预测线） |
| `boards/f2/evidence-ledger` | 证据台账（追加式可复核） |

### F3（随 V1-C 副驾，规划参考）

| 文件 | 内容 |
|---|---|
| `boards/f3/copilot-drawer` | 副驾事件卡 + 为什么这么说 + 降级 |

## 硬约束（任何画板/页面通用）

1. 仪器白 tokens：暖白底 `#e8e6df`、面板 `#f7f6f1`、发丝线 `#d6d3c8/#b9b5a7`、墨黑 `#191b19`、仪器橙 `#f4581c` 唯一强调色；
2. 语义五色：pass 绿 / block 红 / warn 琥珀 / unknown 青灰虚线 / na 淡灰；诊断排序阻断→待补充→警告→通过；
3. 数字（价格/尺寸/规则号/计数/时间）等宽 + tabular-nums + 右对齐；
4. 禁止：渐变、发光、玻璃拟态、圆角卡片堆叠、英文 micro-caps 小标签、空状态图标；
5. 预算未知件 = 斜纹幽灵区，不按零元计入；
6. 真实数据出图：真实型号、真实规则号、真实超差数字，不用 Lorem；
7. 动效预算只给 POST 序列与点亮仪式，且可被 `prefers-reduced-motion` 关闭；
8. 机器画布只是规则示意图，不渲染配件真实外观。

## 开发对照

- 版式 v3 结构（报头 → 项目栏 → 标题行 → 数据行/余量尺 → 两栏规格单）见 `boards/f1/02`；
- 目录署名行（ODC-By）必须随目录下拉展示（M19 契约）；
- 未实现路由（`/builds/[id]/report`、`/markets`、`/evidence`、副驾）开发时以对应规划板为验收基线；
- 每次改版后：`npm run test:e2e` + 浏览器截图对照本目录母版。
