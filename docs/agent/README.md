# RigMate Agent 详细设计索引

这些文档是 PROJECT_MASTER_PLAN 和 AGENT_TECHNICAL_DESIGN 之下的可执行技术规格。后续实现 Agent 时，先读本索引，再按运行时、Prompt、RAG、安全和评测顺序阅读。

## 文档顺序

1. 01-threat-model.md：威胁模型、信任边界、攻击路径和安全门禁。
2. 02-runtime-and-state-machine.md：Agent Runtime、状态机、事件、重试、超时和降级。
3. 03-prompt-tool-contracts.md：Prompt Registry、任务模板、工具契约和权限。
4. 04-rag-grounding-and-claims.md：目录检索、证据检索、重排、Claim Ledger 和事实验证。
5. 05-evaluation-and-operations.md：离线评测、上线门槛、监控、灰度、回滚和事故处理。

## 统一判断原则

- 模型只能建议，系统才能确认事实。
- 任何外部文本都是数据，不是指令。
- 任何写入和外部动作都必须通过 application service。
- 任何精确结论都必须有可验证来源。
- 无法验证时输出 unknown 或提出澄清问题。
