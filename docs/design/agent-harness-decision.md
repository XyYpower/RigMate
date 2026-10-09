# Agent Harness 选型决策（Phase 0 Spike）

> 日期：2026-10-09 · 依据：产品内核与 Agent Runtime 重制计划 v2 §3
> 结论先行：**不引入 Pi 作为生产依赖；借鉴其接口形态，自研薄运行时（mimic interfaces, no reuse-code）。**

## 1. Pi（earendil-works/pi，原 badlogic/pi-mono）审查记录

| 审查项 | 事实 |
|---|---|
| 许可证 | MIT（仓库与 `packages/agent`、`packages/ai` 的 package.json 均为 MIT）；作者 Mario Zechner |
| 结构 | monorepo：`packages/agent`（@earendil-works/pi-agent-core，通用 agent：transport 抽象 + 状态管理 + 附件）、`packages/ai`（统一 LLM API）、以及 coding-agent / durable / evals / mcp / codemode 等周边 |
| agent 核心依赖 | 仅 `@earendil-works/pi-ai` + `typebox`（很干净） |
| pi-ai 依赖 | **很重**：`@anthropic-ai/sdk`、`openai`、`@google/genai`、`@aws-sdk/client-bedrock-runtime`、smithy、http(s)-proxy-agent、partial-json——为多厂商传输层服务 |
| 运行时要求 | node >= 22.19 |
| 权限模型 | AgentTool + before/afterToolCall 钩子（审批门）；工具权限靠钩子拦截，默认能力是"模型可调用任意注册工具" |
| 上下文压缩 | coding-agent 层提供 compaction 钩子（可挂钩控制压缩时机）；核心 agent 只维护 messages 数组，**压缩是通用文本压缩，不保证结构化事实存活** |
| 核心规模 | agent.ts ~613 行 + agent-loop.ts；状态机是"消息驱动循环"，不是业务阶段状态机 |

## 2. 与 RigMate 需求的匹配度

RigMate 需要的不是"通用工具循环 agent"，而是**受约束的选件流水线**：

1. 模型交互是两次受限 JSON 调用（意图解析、候选选择），不是开放式工具循环；
2. 工具是**我们代码按阶段调用的只读领域函数**（searchCatalog / searchEvidence / runCompatibilityCheck），不是模型自由发起的调用；
3. v2 §8 要求的状态机（received → … → answered）、attemptId/deadline/fallback、Claim Ledger 是**业务编排关注点**，Pi 的价值集中在传输/流式/消息循环——重叠很小；
4. v2 §8 要求"压缩只能压解释文本，不能删候选 ID/字段状态/证据 ID/价格状态/规则结果"——这要求**保留结构化事实的领域压缩**，Pi 的通用 compaction 没有这个保证，接管它反而要对抗其消息模型；
5. 引入 pi-ai 会拖进 4 家厂商 SDK 依赖树，与现有零依赖 fetch 版 `infra/llm/client.ts`（OpenAI 兼容）直接冲突。

## 3. 决策

**自研薄运行时**，从 Pi 借鉴四件事（接口形态，非代码）：

- `AgentState` + 事件流的形状 → 我们的 `runtime-types.ts`（phase 状态机 + 事件追加）；
- 工具声明的封闭注册表模式 → 我们的 `tool-contracts.ts`（**类型级封闭**：三个只读工具之外无法注册）；
- before/afterToolCall 审批钩子的思想 → 我们的"模型无写权限"由**封闭注册表 + 无写接口**在类型层保证，不靠运行时拦截；
- compaction 钩子思想 → 我们的"结构化事实保留压缩"（`compressAgentContext`：只裁剪解释性文本）。

Pi 不进 package.json；作为参考实现保留在本文档引用中。若未来需要多厂商流式传输，再单独评估 `pi-ai`。

## 4. 四条硬门验证（见 tests/application/agent-harness-spike.test.ts）

1. 模型只能返回候选 ID —— `validateSelectionOutput` 守卫（Phase 4 已实现，spike 复测）；
2. 模型不能写数据库 —— 工具注册表为封闭三元组（searchCatalog/searchEvidence/runCompatibilityCheck），全部只读；测试断言调用后库内行数不变；
3. 模型失败回退规则路径 —— 选择守卫拒绝后由同一 CandidateSet 的规则排序生成完整方案；
4. 压缩后事实存活 —— `compressAgentContext` 裁剪 retrievalReasons/解释文本后，候选 ID、qualityStatus、missingFields、价格状态、规则结果仍在。

## 5. 遗留与后续

- Phase 5 的 orchestrator.ts / run-state.ts / context.ts 按本决策实现；
- promptVersion 由 prompts/registry.ts 提供（selection-v1），随 AgentEvent 落库；
- "模型提出多个方案方向"（Phase 4）在本决策之后实现，每个方向走同一套验证。
