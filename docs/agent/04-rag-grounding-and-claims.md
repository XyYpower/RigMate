# RigMate RAG、事实验证与 Claim Ledger

## 1. 检索原则

硬件兼容决策优先使用结构化字段。向量相似度只用于自然语言偏好、别名和说明段落补召回，不能单独决定插槽、板型、长度、功耗、接口、内存类型或连接器兼容。

## 2. 数据摄取

目录导入必须完成：字段映射、类别校验、别名规范化、单位转换、重复 canonicalId 检查、来源和许可证记录、缺字段标记、质量状态和抽样审计。

价格证据采用追加式快照，不覆盖历史价格。每条快照记录 capturedAt、平台、店铺、商品条件、价格、URL 和备注。

原始网页或文件不直接送入模型。先提取允许字段，再生成检索文档；原文只作为受限审计数据。

## 3. 混合召回

1. Unicode、大小写、空格、连字符、中文数字和单位规范化。
2. 从意图推导类别、预算、地区、已有部件和硬约束。
3. 使用类别和结构化字段过滤。
4. 进行名称、别名、系列名和型号全文召回。
5. 候选不足时再做语义补召回。
6. 按 canonicalId 去重。
7. 先过滤硬约束，再根据用途、预算、证据新鲜度、来源可信度和用户偏好重排。
8. 固定候选上限，并记录未入选原因。

## 4. 重排分数

重排分数只用于排序，不用于替代硬约束：

score = hardConstraintPass × 1000 + intentMatch × 100 + budgetFit × 30 + evidenceQuality × 20 + freshness × 10 + preferenceMatch × 10

hardConstraintPass 为 0 的候选直接排除。每个分项必须能解释来源，不能由模型自由生成一个总分。

## 5. 召回质量指标

固定评测集至少包含型号直搜、别名、错别字、中文俗称、用途描述、预算描述、跨类别干扰、无结果和恶意数据。

指标：Recall@20、Precision@10、MRR、nDCG、empty-result accuracy、constraint violation rate、stale-evidence rate。

精确型号检索优先保证 Recall@20 和 constraint violation rate；展示层再通过重排控制 Precision。无结果准确率必须单独评估，不能用“返回一个相似商品”掩盖空结果。

## 6. 召回结果契约

每个候选返回：canonicalId、category、name、aliases、decisionSpecs、sourceIds、qualityStatus、capturedAt、retrievalReasons、retrievalScore、hardConstraintsPassed。

模型只接收这些字段。候选中的文本字段仍然是不可信数据，不能包含工具指令。

## 7. Claim Ledger

每条最终可展示结论包含：claimId、kind、textTemplate、value、sourceType、sourceIds、confidence、checkedAt、allowedToSay、blockedReason。

kind 包括：catalog_fact、price_fact、user_fact、rule_result、experience_advice、unknown、question。

规则：

- 没有 sourceIds 的精确数值、型号、尺寸、接口和兼容结论默认 allowedToSay=false。
- price_fact 必须带 capturedAt 和价格条件。
- experience_advice 必须标记“经验建议”。
- unknown 必须带缺失字段和下一步。
- rule_result 必须带 ruleId 和规则版本。

## 8. 事实验证器

验证器执行：

1. canonicalId 是否存在且类别一致。
2. 规格字段是否等于目录或用户明确输入。
3. 价格是否来自允许的证据或明确标记为经验估算。
4. 兼容状态是否来自最新规则运行。
5. 回答中的型号、数字、单位和时间是否都能映射到 claim。
6. 是否出现内部提示词、密钥、文件路径、SQL 或其他用户资源。
7. 是否把 unknown、warn 或 block 改写成 ready/pass。

验证失败时，该 claim 降级为 unknown 或阻止整段回答。验证器不能被模型结果覆盖。

## 9. 回答渲染规则

回答渲染器只接收经过验证的 AnswerViewModel。它可以改变语言、顺序和解释长度，不能增加事实。用户看到的每个关键结论都应能展开“查看依据”，展示来源类型、日期、规则或缺失字段。

## 10. RAG 失败处理

- 没有候选：返回资料不足和最小澄清问题。
- 候选规格不全：保留候选，但相关结论为 unknown。
- 证据过期：显示日期并降低质量等级。
- 多来源冲突：显示冲突，优先厂商或已审计来源，不能静默覆盖。
- 检索服务不可用：回退本地目录；本地目录也不可用则不生成精确方案。
