<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## RigMate 开工前必读

本仓库**有多个 AI 并行开发**。改代码前先看工作线分工，避免覆盖别人的在制品。

1. 读 `docs/AI_COLLABORATION.md` §0.5「并行工作线登记」——那里有**别的 AI 正在改哪些路径**，以及本工作线不要碰的文件清单。
2. 改目录数据、规格字段或产品名显示前，读 `docs/CN_CATALOG_AND_LOCALIZATION.md`。
3. 业务规则以 `docs/PC_DIY_装机助手_业务逻辑规格_v1.md` 为准；总计划见 `docs/PROJECT_MASTER_PLAN.md`。

### 不可动摇的数据纪律（违反会污染质量门）

- **规格字段永不翻译、不猜测**。解析不到就留空，绝不用同系列/同模具推断。
- **错值比缺字段危险**。带 S1 官方来源标记的错误字段会通过质量门去驱动兼容性规则。
  采集器必须有取值合理区间与撞车回退这类安全阀。
- **写库前先备份** `data/rigmate.db`。
- 验证命令：`npm run lint && npm run typecheck && npm test && npm run build`，
  外加 `npx tsx scripts/data-release-gate.ts`（数据门禁 6 项）。
  **E2E 必须在静默机器上跑**，且先清掉 3000 端口的 dev server。