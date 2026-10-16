# M4 回答与建议层实施计划（launch-readiness Phase 2 / blueprint M4）

**Goal:** 会话的「问依据」从指引文案升级为真实回答（确定性模板，模型零参与、零幻觉面）；库外产品提示获得「加入待审核队列」的闭环入口（只写 pending_catalog_queue，不自动建产品、不进正式方案）。

**Architecture:** AnswerDraft 是回答层契约——回答只能引用已存在的事实（方案项 rationale / 质量状态 / 价格口径 / 兼容结论），中文文案由渲染器生成，模型不产出新数字或型号。队列入口复用既有 POST /api/catalog/queue（new_product 类型）。

**已有资产（本计划不重做）：** advice lane（experience_advice + external_product_hint，v4.27）；claims 账本（contracts/agent.ts 七类主张）；pending_catalog_queue 表 + POST API（catalog-review service）。

---

### Task 1: AnswerDraft 契约 + 确定性解释通道

**Files:**
- Modify: src/contracts/design.ts（answerDraftSchema：summary/actions/questions/claimIds/adviceIds，strict）
- Create: src/domain/design/explain.ts（buildExplainAnswer + renderAnswerDraft）
- Modify: src/domain/design/revision.ts（导出 categoriesMentionedIn）
- Modify: src/application/design/service.ts（问句路由：能定位类别的问句给真实解释，否则保持 M3 指引）
- Test: tests/domain/design-explain.test.ts

- [ ] 失败测试：问句点名类别（"为什么选这个显卡"）→ AnswerDraft.summary 含该件 rationale 与价格口径；问全部（"为什么这么搭"）→ 概览式回答；问目录里没有的类别 → null（回落指引）；draft 含 adviceIds（建议引用）与 claimIds（本轮无持久化 claims → 空，诚实）。
- [ ] 提交 `feat: answer explain questions from proposal facts via answer draft`。

### Task 2: 库外产品提示 → 待审核队列入口

**Files:**
- Modify: src/ui/session/experience-advice.tsx（use client；external 项加「加入待审核队列」按钮 + 成功/失败就地反馈）
- Create: src/ui/session/advice-queue.ts（externalHintQueuePayload 纯函数：advice → POST body）
- Test: tests/ui/advice-queue.test.ts

- [ ] 失败测试：payload = { queueType:"new_product", category, userInput: productName, reason: detail+方案来源标记, priority }；experience_advice 无 payload（按钮只给待验证产品）。
- [ ] 实现：按钮只出现在 external_product_hint 项；POST /api/catalog/queue 成功后按钮变「已进审核队列」并禁用；失败显示错误文本。不自动创建 canonical product，不影响接受路径（蓝图 §7.3 红线）。
- [ ] 提交 `feat: queue external product hints for catalog review`。

### Task 3: 门禁 + 真实验证 + 文档 + 推送

- [ ] lint / typecheck / test / build 全绿。
- [ ] 真实验证（GLM）：会话中问「为什么选这个显卡」→ question 事件含该件真实 rationale；如有库外提示则走一遍队列入口（或直接 POST 验证 API 通路）。
- [ ] 更新 AI_COLLABORATION.md（v4.31）并推送。

### 明确不做（边界）

- AnswerDraft 的 LLM 参与版（选 claim 生成回答）：M4 首版回答全部确定性渲染——模型只产出结构化候选/建议，回答文案由模板生成（蓝图 §7.4「不能由模型添加新的数字或型号」的最强实现）；
- claims 跨轮持久化（问依据时引用创建时的 claimIds）：claim 现存于创建轮 runtime，持久化涉及新列，待 Phase 5 观测需求明确后再做；
- compatibility_explain 的独立 LLM 解释调用：模板已可回退且足够诚实，避免每问一次花一次模型调用；引入与否由 Phase 5 延迟/成本基线决定。
