# 视觉 token 对照表

> 设计契约见根目录 `DESIGN.md`；本文只维护实现层的变量映射。
> 实现位置：`src/ui/theme.css`（`--wb-*` 新体系）+ `src/app/globals.css`（消费）。
> 迁移策略：旧 `--rm-*` 变量保留为兼容别名，逐页面切换后删除。

## 核心映射

| 用途 | 新 token | 值 | 旧别名（兼容期） |
|---|---|---|---|
| 画布 | `--wb-canvas` | `#f4f5f6` | `--rm-bg` |
| 面板 | `--wb-surface` | `#ffffff` | `--rm-panel` |
| 面板次底 | `--wb-surface-subtle` | `#f8f9fa` | — |
| 发丝线 | `--wb-hairline` | `#e5e7eb` | `--rm-line` |
| 强线 | `--wb-hairline-strong` | `#d1d5db` | `--rm-line-strong` |
| 主文字 | `--wb-ink` | `#111827` | `--rm-ink` |
| 次文字 | `--wb-ink-muted` | `#6b7280` | `--rm-ink-muted` |
| 弱文字 | `--wb-ink-faint` | `#9ca3af` | `--rm-ink-faint` |
| 强调橙 | `--wb-accent` | `#f4581c` | `--rm-accent` |
| 橙 hover | `--wb-accent-hover` | `#e14e12` | — |
| 橙浅底 | `--wb-accent-soft` | `#fdeee5` | — |
| 通过 | `--wb-pass` | `#16a34a` | `--rm-pass` |
| 注意 | `--wb-warn` | `#d97706` | `--rm-warn` |
| 阻断 | `--wb-block` | `#dc2626` | `--rm-block` |
| 未知 | `--wb-unknown` | `#6b7280` | `--rm-unknown` |

## 语义底色（StatusBadge 用）

- pass 底 `#ecfdf3`、warn 底 `#fffaeb`、block 底 `#fef3f2`、neutral 底 `#f3f4f6`。

## 形状与阴影

- 圆角：面板 `--wb-radius-panel: 12px`；控件 `--wb-radius-control: 8px`；徽章 pill。
- 阴影：`--wb-shadow-panel: 0 1px 2px rgba(16,24,40,0.05)`（仅浮层）。

## 动效

- `--wb-fast: 150ms`、`--wb-slow: 250ms`；呼吸 1.2s；尊重 `prefers-reduced-motion`。
