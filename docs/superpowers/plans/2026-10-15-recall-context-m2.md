# M2 召回上下文与动态候选池实施计划（launch-readiness Phase 2 / blueprint M2）

**Goal:** 让候选召回「少而完整、可解释、可测量」：型号规范化命中、按信息来源分桶、动态 K 控制上下文体积、decisionSpecs 白名单收窄模型可见字段、每类留下进入/落选的账目；先建离线召回评测基线，再接 Agent。

**Architecture:** 全部检索逻辑保持领域层纯函数（`src/domain/catalog/`）；`CandidateSummary` 向后兼容地增加 `bucket` 与 `decisionSpecs`；三处模型提示词（选件/换件/建议）从裸 `spec` 切到白名单字段；离线评测脚本默认离线可重放，真实目录上跑基线。

**对应当前短板（2026-10-14 实测）：**
- 池内 745 条（cpu 157 / mb 138 / gpu 92 / psu 80 / cooler 76 / case 66 / storage 65 / ram 71），八类 ≥30 达标；
- 651 条有中文名、812 条有别名——检索却只做子串包含，别名价值没兑现；
- 每类固定 12 条 × 8 类 ≈ 8-10k tokens 候选上下文，无关字段（CPU 频率等）一并塞给模型；
- 精确型号 Recall@20 / 别名 Recall@20 没有测量。

---

### Task 1: 型号文本规范化（纯函数）

**Files:**
- Create: src/domain/catalog/normalize.ts
- Test: tests/domain/catalog-normalize.test.ts

- [ ] 失败测试：`normalizeModelText` 处理 大小写 / 全角字符 / 空格与连字符 / 括号注记剥离（如「AMD RX 7600（参考规格）」→ amd rx 7600）；`modelTokens` 抽取型号 token（9800X3D / 4070S / B850M）。
- [ ] 实现：lowercase → 全角转半角 → 剥离全半角括号注记 → 去空格/连字符/点。
- [ ] 提交 `feat: normalize model text for catalog recall`。

### Task 2: 分桶检索 + 动态 K + 类目账目

**Files:**
- Modify: src/domain/catalog/ranking.ts（CandidateSummary 增 `bucket?`；新增 `buildCategoryCandidates`）
- Test: tests/domain/catalog-bucketing.test.ts

- [ ] 失败测试：桶序 exact → alias → ranked（现有 rank 排序补满）→ diversity（不同 tier 各补 ≤2）；默认 K=6、exact 桶非空时该类扩到 20；去重保序；空类目返回 missing；每类 stats = { considered, pooled, rejectedByQuality, rejectedByNameLength }。
- [ ] 实现：复用 rankCandidates 作第三桶排序器；规范化匹配 name/aliases/nameZh（exact = 全串相等，alias = token 命中）；候选带 bucket 标注。
- [ ] 提交 `feat: bucketed recall with dynamic k and per-category stats`。

### Task 3: decisionSpecs 白名单

**Files:**
- Create: src/domain/catalog/decision-specs.ts
- Modify: src/domain/catalog/ranking.ts（CandidateSummary 增 `decisionSpecs`）
- Modify: src/application/design/intent-llm.ts（renderCatalogSelectionPrompt / renderSwapPrompt 改传 decisionSpecs）
- Modify: src/application/design/advice-llm.ts（候选透出改 decisionSpecs 摘要）
- Test: tests/domain/catalog-decision-specs.test.ts；回归 tests/application/design-llm-intent.test.ts

- [ ] 失败测试：每类白名单覆盖该类规则消费的全部字段（cpu socket/tdpWatts/ptpMaxWatts/hasIgpu/m2Lanes…；mb socket/formFactor/ramType/ramSlots/m2Slots/sataPorts/pcieX16Slots/vrmScore…；gpu tdpWatts/pcie8pin/twelveVhpwr/vramGb/lengthMm…；psu ratedWatts/pcie8pin/twelveVhpwr/formFactor…；cooler 高度/接口；ram 类型/容量/高度；storage 接口；case 限长/限高/板型）；summary.decisionSpecs 只含白名单键。
- [ ] 实现：白名单常量 + `decisionSpecsOf(category, spec)`；提示词渲染切白名单（模型不再看到无关频率/营销字段）。
- [ ] 提交 `feat: whitelist decision specs shown to the model`。

### Task 4: 接线 Agent 链路

**Files:**
- Modify: src/application/agent/tools/catalog-tools.ts（searchCatalog 工具改用 buildCategoryCandidates）
- Modify: src/application/agent/orchestrator.ts（逐类 limit 语义换动态 K；检索事件消息附 bucket/stats 摘要）
- Modify: src/application/design/service.ts（空结果/缺类别追问消息附最小动作：放宽预算/等待审核/进 DIY）
- Test: tests/application/agent-orchestrator.test.ts 回归 + catalog-tools 新用例

- [ ] 失败测试：工具返回带 bucket 与 decisionSpecs；exact 命中扩 K 生效；orchestrator 池仍只含质量门内候选。
- [ ] 接线；空结果文案按缺失类别给一个最小动作。
- [ ] 提交 `feat: wire bucketed recall into agent tools`。

### Task 5: 离线召回评测与基线

**Files:**
- Create: scripts/run-recall-evals.ts（默认离线打印报告；--json 写 data/evals/recall-report.json）
- Create: data/evals/recall-cases.json（≥30 条：精确型号 10 / 别名与中文俗称 10 / 错别字 5 / 空结果 5；期望一律写「必须命中的名称子串」而非具体 id，降低数据批次脆弱性）
- Modify: package.json（`evals:recall` 脚本）

- [ ] 实现指标：Recall@6 / Recall@20 / MRR / 空结果准确率（该空则空）。
- [ ] 在真实目录跑基线，阈值记录进报告（冻结前不设卡；blueprint §9.3 的 90% 目标作为参照）。
- [ ] 提交 `feat: offline recall eval harness and baseline`。

### Task 6: 全量门禁 + 真实验证 + 文档

- [ ] lint / typecheck / test / build 全绿。
- [ ] 真实验证：创建一次方案，检查检索事件带 bucket/stats、模型提示词只见 decisionSpecs、上下文体积下降（池 96→约 48 条摘要）。
- [ ] 更新 AI_COLLABORATION.md（v4.29）并推送。

### 明确不做（本里程碑边界）

- 硬约束不作为召回过滤器（避免唯一候选被过滤），仅继续作为方案层规则；重排惩罚归 M3 任务路由后评估；
- 向量库 / FTS 不引入（结构化召回先行，launch design §0 冻结项）；
- revision 提示词 registry 化、追问影响分归 M3。
