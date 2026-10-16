# M5 真实样本与成本调优实施计划（launch-readiness Phase 2 / blueprint M5）

**Goal:** 用真实 GLM 建立三张基线表——意图理解、修订保持、选件组合（已有）——全部带延迟 / schema 失败率 / token 用量；用数据回答"思考模式用在哪、候选池多大、哪些调用该省"，为 Phase 5 观测与发布阈值（blueprint §9.3）提供冻结前的数字。

**Architecture:** 评测全部是独立脚本（默认离线，--live 才发请求，key 不落盘不打印）；固定样本进版本库（data/evals/ 豁免），报告写本地 data/evals/*.json；LLM 客户端补 token 用量透传（GLM 响应自带 usage）。

**已有资产：** evals:live（选件组合对比，fixture 池 + 真实模型）、evals:recall（召回 32 条）、advice 思考 A/B（7.9s vs 70s，v4.27 踩坑记录）。

---

### Task 1: LLM 客户端 token 用量透传

**Files:**
- Modify: src/infra/llm/client.ts（ok 分支附可选 usage: { promptTokens, completionTokens, totalTokens }）
- Test: tests/infra/llm-client.test.ts 追加

- [ ] 失败测试：mock 响应带 usage → result.usage 透传；无 usage 字段 → undefined（不猜）。
- [ ] 提交 `feat: capture token usage from llm responses`。

### Task 2: 意图理解评测（30 条固定样本）

**Files:**
- Create: data/evals/intent-cases.json（12 正常目标含期望预算/用途/外观；6 已有硬件；6 缺槽位应追问；3 域外请求；3 歧义预算）
- Create: scripts/run-intent-evals.ts（rules 与 live LLM 双路对比；指标：预算准确率、槽位 F1、追问正确率、延迟、schema 失败率、token）
- Modify: package.json（evals:intent）

- [ ] 指标定义：预算准确率 = 期望 cents 全等；槽位 F1 = useCases∪appearance 集合 F1；追问正确 = expectFollowup 与 followupQuestion 存在性一致。
- [ ] 提交 `feat: intent understanding eval harness`。

### Task 3: 修订保持评测（10 条多轮样本）

**Files:**
- Create: data/evals/revision-cases.json（beforeIntent + instruction + 期望触达字段；含纯预算/外观组合/库外话题）
- Create: scripts/run-revision-evals.ts（live reviseIntentWithLlm + mergeRevisionIntent；指标：未触达字段保持率、越权拒绝率、延迟、token）
- Modify: package.json（evals:revision）

- [ ] 指标定义：字段保持 = 合并后未触达字段与 before 全等（守卫后必然成立，评测的是守卫开启时的模型原始漂移率——modelIntent 与 before 在未触达字段上的差异次数）；越权拒绝 = rejectedFields 非空即记。
- [ ] 提交 `feat: revision field-retention eval harness`。

### Task 4: 跑基线 + 记录 + 推送

- [ ] live 跑 intent（思考开=现产线全量 30；思考关对照子集）+ revision + 选件（复用 evals:live，补 usage 记录）。
- [ ] 报告存 data/evals/（本地），摘要（指标 + 成本结论：思考模式用在哪些调用）写进 AI_COLLABORATION.md v4.32。
- [ ] 门禁全绿，推送。

### 明确不做（边界）

- 100 条全量样本库：本轮 30+10+32+9=81 条，其余随 Beta 真实会话补（blueprint §9.1 允许首批渐进）；
- 事实类指标（claim support rate）：grounding 验证器已在生成路径强制（违反即阻断），离线评测待 AnswerDraft 接入 claims 后补；
- 人工复核抽检（§9.4）：等内部 Alpha 用真实会话做。
