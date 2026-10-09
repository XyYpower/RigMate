# RigMate 产品内核恢复与 M37 修订计划

> **Goal:** 让目标驱动方案真正使用可检索目录、质量状态和价格证据，再在事实基础上完成受约束选件与评测。

## 1. 采纳的核心判断

评价中已由代码和开发库核实的关键问题：

- 方案生成仍由固定 PREFERRED_IDS、预算 if/else 和 ITEM_PRICE_ESTIMATES 主导，26,204 条目录没有成为真实候选空间。
- candidatePool 按加载顺序截取每类前 12 条，seed/manual 会遮蔽 BuildCores，模型看到的候选和规则回退几乎相同。
- proposalItem 把所有候选写成 verified_catalog，与当前只有 2 个 verified 产品的事实冲突。
- 当前开发库 price_evidence 为 0 行，方案价格来自源码常量，不来自价格证据台账。

这些问题比继续扩展 UI 或 Agent 编排更优先，因为它们直接决定产品是否真的在“用数据配机”。

## 2. 本轮范围

保留现有模块化单体、SQLite、手写幂等迁移和确定性规则。先恢复：

目录检索 → 质量门 → 价格证据 → 组合检查 → 方案解释

模型只接收经过筛选的候选摘要，不能直接读取数据库或写入正式方案。暂不把 RSC 重写、Drizzle 迁移、Tailwind 清理、DIY 拆分和公开多用户认证混入本轮；这些另立技术债计划。

## 3. Task A：质量状态进入方案候选

文件：src/contracts/design.ts、src/domain/design/proposal.ts、src/application/design/service.ts、src/infra/catalog-import/load.ts、相关 application/domain tests。

- [ ] 候选只允许 qualityStatus 为 verified 或 supported；partial/conflicting/stale/rejected/merged 一律排除。
- [ ] 新增 supported_catalog 来源级别；verified 映射 verified_catalog，supported 映射 supported_catalog，禁止硬编码 verified。
- [ ] 候选不足时返回缺失类别和 unknown，不能用 partial 凑齐八类。
- [ ] ProposalItem 携带字段质量状态和 evidence source IDs。
- [ ] 接受方案时把字段质量和证据引用传入 BuildItem，使 gateFieldQuality 真正生效。
- [ ] 回归覆盖不存在型号、商家自拟名、partial/conflicting 候选、候选不足和质量变 stale 后重新检查。

## 4. Task B：真实目录检索与排序

文件：src/domain/catalog/search.ts、新增 src/domain/catalog/ranking.ts、src/application/design/service.ts、src/domain/design/proposal.ts、检索与流水线测试。

- [ ] 从 StructuredIntent 生成类别、预算、用途、外观和约束过滤条件。
- [ ] 先硬过滤质量状态和类别，再按关键字段完整度、预算距离、用途/外观匹配、已有硬件约束和价格证据新鲜度排序。
- [ ] 候选摘要包含 canonicalId、decision specs、qualityStatus、source IDs、缺失字段和 retrievalReasons。
- [ ] 重新设计 candidatePool，不能依赖数据库加载顺序或固定 seed 前 12 条。
- [ ] 先用可测量的规范化线性检索；只有评测显示延迟或召回不足，才单独规划 FTS5。

## 5. Task C：移除方案生成中的伪价格事实

文件：src/domain/design/proposal.ts、新增 src/application/design/price-context.ts、src/infra/db/repositories/price-evidence-repository.ts、设计契约和价格测试。

- [ ] 按 canonical product、地区和审核状态读取价格证据。
- [ ] 只有 review_status=verified 的价格进入正式估算区间，并携带 evidence IDs 和 capturedAt。
- [ ] 删除 ITEM_PRICE_ESTIMATES 和 PRICE_ESTIMATES 在正式方案路径中的作用。
- [ ] 没有已审核价格证据时，价格上下限为 null，priceBasis=unknown，界面显示暂无已审核价格证据。
- [ ] unreviewed/rejected/跨地区价格不能进入方案预算结论。

## 6. Task D：真实受约束模型选件与评测

文件：src/application/design/intent-llm.ts、src/application/design/service.ts、模型选择测试、新增 data/evals/design-selection-cases.json 和评测测试。

- [ ] 模型只接收 Task B 输出的有限候选摘要，不再接收加载顺序截断的 seed 候选。
- [ ] 非法 ID、重复类别、越权字段、编造规格和不满足质量门的选择全部拒绝并回退规则式排序。
- [ ] 固定评测覆盖预算、剪辑+游戏、白色外观、已有电源、商家自拟名、无匹配、候选不足、超时和非法 ID。
- [ ] 精确型号/规格/价格 unsupported claim rate 为 0；模型关闭、失败或超时时规则式路径仍可运行。
- [ ] 保存检索候选、最终选择、质量状态、价格证据、规则结果和 unknown 项，形成 5–10 个脱敏目标报告。

## 7. Task E：可复现数据基线与部署边界

文件：README.md、scripts/data-release-gate.ts、新增 fixture 脚本和测试、package.json。

- [ ] README 明确当前为本地单用户工具，无认证和项目隔离，Docker 不得直接暴露公网。
- [ ] 新增临时数据库 fixture 命令，让 fresh clone 能验证 schema、seed 和门禁逻辑；不能把空生产库自动判成已发布。
- [ ] 保留真实库 G1–G6 门禁语义。
- [ ] 过程型 verify-batch-* 脚本先保留为可审计重放记录，暂不为了清理而移动或删除。

## 8. 后置技术债

以下问题确认存在，但不阻塞本计划：

- RSC/server component 数据流重构；
- Drizzle schema 与手写迁移统一；
- Tailwind 依赖和双 token 清理；
- DIY 大组件拆分；
- FTS5 性能优化；
- Docker 镜像瘦身和真实构建；
- 认证、项目隔离和公开部署。

每项都应在产品内核恢复后独立成计划，避免再次把工程清理误当成产品能力。

## 9. 恢复 UI 迭代的门槛

只有同时满足以下条件，才继续新增 UI 组件或视觉功能：

1. 候选来自真实质量过滤后的目录，而不是固定 seed 表；
2. 价格不再来自源码常量；
3. 方案项不再把 partial 冒充 verified；
4. 模型候选池相对规则回退有可测量增益；
5. 5–10 个真实脱敏目标完成检索、价格、质量和规则结果记录。

## 10. 验收

运行：

- npm run gate:data:fixture
- npm run typecheck
- npm run lint
- npm test
- npx playwright test
- npm run build

验收必须确认：目录投入能产生真实候选；没有 verified 价格时显示 unknown；每个方案项可回溯 qualityStatus、字段状态和 evidence IDs；质量不可用的字段只能输出 unknown；模型失败时规则式路径仍可用；fresh clone 能运行 fixture 门禁。
