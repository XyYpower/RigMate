# Phase 5 观测与运行诊断实施计划（launch-readiness Phase 5 / blueprint §9.2 运行指标）

**Goal:** 每个 AgentRun 可观测：从已落库的富事件算出延迟 / 回退 / 失败摘要（纯函数），诊断页对最近会话聚合 P50/P95 与回退率；顺带补齐规则降级四缺口（无 LLM 兜底质量）与换件通道的思考 A/B 数据。

**Architecture:** 聚合器是纯函数（application/agent/run-metrics.ts，只吃 RigEnvelope）；诊断 API 读 agent_event_log + design_requests，不改写路径；诊断页是只读管理页（/diagnostics，与 /hardware /review 同风格）。

---

### Task 1: run 指标聚合器

**Files:**
- Create: src/application/agent/run-metrics.ts（summarizeRequestEvents：按 runId 分组 → RunMetrics：totalMs / 每工具 calls+totalMs+errors / fallbackCount / anomalyCount / selection+revision+advice 分项 / question+answer 计数）
- Test: tests/application/run-metrics.test.ts

- [ ] 失败测试：构造一段完整 run 事件 → 断言 totalMs、tool_call 时长（finishedAt-startedAt）、advice 分项、fallback 计数；多 run 分组；无 run_completed 时 totalMs=null。
- [ ] 提交 `feat: summarize run metrics from rig events`。

### Task 2: 诊断 API + /diagnostics 页

**Files:**
- Create: src/app/api/diagnostics/route.ts（GET：最近 20 会话 × 每 run RunMetrics + 聚合 P50/P95/回退率）
- Create: src/app/diagnostics/page.tsx（只读管理页：聚合卡 + 会话×运行表；风格对齐 /hardware）
- Modify: src/ui/components/nav-shell.tsx（场景入口加「运行诊断」）
- Test: tests/application/diagnostics-aggregate.test.ts（聚合百分位纯函数）

- [ ] 提交 `feat: run diagnostics api and admin page`。

### Task 3: 规则降级四缺口修复（intent.ts）

**Files:**
- Modify: src/domain/design/intent.ts（中文数字两万；N万M 尾数；大概/左右修饰词；已有件后置语序）
- Test: tests/domain/design-intent.test.ts 追加（对照 evals:intent 的四个失败样本）

- [ ] 对应评测失败样本：「预算两万」（中文数字）、「2 万 5」（尾数）、「预算大概 8000 左右」（修饰词）、「机箱保留用旧的」（后置语序）。
- [ ] 提交 `feat: close four rule-based intent parsing gaps`。

### Task 4: 换件 A/B harness + live 决策

**Files:**
- Create: scripts/run-swap-evals.ts（fixture 冲突组合 → proposeSwapWithLlm 思考开/关；指标：提案率、采纳后阻断/警告改善、延迟）
- Modify: package.json（evals:swap）

- [ ] live 跑 3 案例 × 2 配置；按数据决定换件通道思考策略（同 M5/M6 判据：无稳定增益即关）。
- [ ] 提交 `feat: swap thinking ab harness and baseline`。

### Task 5: 门禁 + 文档 v4.34 + 推送

### 明确不做

- feature flag 灰度：RIGMATE_LLM_API_KEY 已是总开关，逐通道 flag 等 Alpha 反馈再定；
- 成本指标：GLM 端点不回 usage，面板以延迟/回退为主，token 列留空位。
