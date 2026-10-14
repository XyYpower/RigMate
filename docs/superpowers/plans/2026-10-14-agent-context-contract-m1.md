# M1 任务和会话契约实施计划（launch-readiness Phase 2 / blueprint M1）

**Goal:** 冻结会话上下文契约与修订合并规则，让连续多轮修改不丢字段：模型只被允许改动用户明确提及的字段，每轮修订都留下 before/instruction/model/merged 的审计痕迹。

**Architecture:** 全部纯函数落在 `src/domain/design/`（不依赖 DB/网络/模型）；service 的 LLM 修订路径先过合并守卫再采用；审计通过新的 rig 事件 `revision_merged` 进 agent_event_log（前端 reducer 对未知类型天然忽略，UI 零改动）。

**对应验收（launch-readiness §8 Phase 2）:** 连续「预算/用途 → 外观/静音 → 已有部件」三轮不丢字段；每轮可定位模型理解错在哪。

---

### Task 1: ConversationContext 契约 + 构建器

**Files:**
- Create: src/domain/design/conversation-context.ts
- Test: tests/domain/conversation-context.test.ts

- [ ] 失败测试：从 request+proposal 构建上下文（turn、selectedIds、tradeoffs、findings 来自 compatibility+unknowns、recentUserMessages 截取最近 2 条）；无方案时 latestProposal=null。
- [ ] 实现 `conversationContextSchema`（strict）与 `buildConversationContext`：
  requestId / turn / intent / confirmedFields / pendingQuestion / latestProposal{id,version,selectedIds} / latestTradeoffs / latestFindings[{ruleId,status,conclusion}] / recentUserMessages(≤2)。
- [ ] 提交 `feat: freeze conversation context contract`。

### Task 2: 修订合并守卫（字段来源优先级）

**Files:**
- Create: src/domain/design/revision-merge.ts
- Test: tests/domain/revision-merge.test.ts

- [ ] 失败测试六条：触及的预算改动被接受；模型擅自清空未触及字段被拒绝（保留 before 值 + 记 rejectedFields）；触及的外观改动被接受、同轮其他漂移被拒；预算有确定性解析时用户显式值优先于模型值；模型与 before 全等时两个列表皆空；`revisionTouchedFields` 识别六类字段关键词。
- [ ] 实现 `revisionTouchedFields(instruction)` 与 `mergeRevisionIntent({before, instruction, modelIntent})`：
  字段 = budgetCents/useCases/appearance/existingParts/constraints/region；
  优先级 = 当前轮用户显式（仅预算有确定性解析）> 模型解析（仅当指令触及该字段）> before 值。
- [ ] 提交 `feat: guard revision merge by user-touched fields`。

### Task 3: 接入 reviseDesign + 逐轮审计

**Files:**
- Modify: src/contracts/agent-events.ts（rig 事件新增 `revision_merged`）
- Modify: src/application/design/intent-llm.ts（reviseIntentWithLlm 接受可选 ConversationContext，用户提示附最近语境）
- Modify: src/application/design/service.ts（LLM/规则两条修订路径都过 mergeRevisionIntent；发 revision_merged 事件：instruction/beforeIntent/modelIntent/mergedIntent/changedFields/rejectedFields）
- Modify: src/infra/db/repositories/design-repository.ts（countAgentRuns 供 turn 计数）
- Test: tests/application/design-service-revision-merge.test.ts；回归 tests/application/design-service.test.ts

- [ ] 失败测试：mock LLM 返回「清空预算 + 只改外观」的漂移意图 → 修订后预算保留、外观生效、事件日志含 revision_merged 且 rejectedFields 含 budgetCents。
- [ ] 接线；reducer 对新事件类型忽略（log 留痕、不进时间线），UI 与 E2E 零影响。
- [ ] 提交 `feat: audit revision turns and block unintended field drift`。

### Task 4: 门禁 + 真实验证 + 文档

- [ ] lint / typecheck / test / build 全绿。
- [ ] 真实验证（GLM）：创建 → 修订①（预算）→ 修订②（外观+已有件），连续三轮意图字段不丢；revision_merged 事件落库可查。
- [ ] 更新 AI_COLLABORATION.md（v4.28）并推送。

### 明确不做（后续里程碑）

- 追问影响分与追问码（blueprint §4）→ M1 后续小节；
- revision 提示词入 prompts/registry 版本化 → M3（Prompt Registry）；
- 规范化召回 / 分桶 / 动态 K / decisionSpecs 白名单 → M2；
- 任务路由表（intent_extract/retrieve_query/...）的确定性分类器 → M3。
