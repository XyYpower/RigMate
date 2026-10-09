# 产品内核恢复与受约束选件 · 验收评审（v2 Phase 6）

> 日期：2026-10-09 · 分支：`feat/decision-bench-ui`
> 依据：`docs/superpowers/plans/2026-10-09-rigmate-product-core-and-agent-runtime-v2.md`
> 数据口径：**fixture 基线**（`src/infra/catalog-import/fixture.ts`：16 条 supported 目录 + 13 条已审核价格证据），9 个脱敏目标走完整检索 → 质量 → 价格 → 规则 → 守卫管线；生产数据（26k partial + 2 verified）行为另行说明。

## 1. 管线事实（Phase 1–3）

- **候选空间**：质量硬过滤（verified/supported）→ 线性排序（必填字段完整度 0–40 + 预算 ±30/20 + 外观 10 + 约束 5 + 价格新鲜度 5，同分预算内更高档优先）→ 每类前 8 进候选池。数据库加载顺序、固定 PREFERRED_IDS 不再参与候选选择。
- **价格**：只有 `review_status=verified`、地区匹配、绑定 canonical product 的价格进入方案；无证据 → 上下限 null、`priceBasis=unknown`、界面"暂无已审核价格证据"。源码常量估价已删除。
- **质量回溯**：方案项携带 `qualityStatus / fieldQuality / evidenceSourceIds`（迁移 v11 持久化）；接受方案时下传 BuildItem，`gateFieldQuality` 在复检/重开后仍生效；质量不可用字段只能得到 unknown 结论。
- **候选不足**：返回缺失类别 + unknown，不用 partial 凑八类；全空时诚实追问而不是生成空方案。

## 2. 受约束选件（Phase 4）

- 模型输入只含 CandidateSet 摘要 + 结构化意图（无 repository / SQL / 网页）；
- 输出 strict schema（selections 之外任何键 = 整体拒绝）；守卫拒绝池外 ID、类别错配、重复类别、质量不达标；
- 失败/超时回退到**同一 CandidateSet 的规则排序**（不回退 PREFERRED_IDS）；
- 提示词版本化（`prompts/selection-v1` + registry），promptVersion 随事件落库可审计。

## 3. 评测结果（`npm run evals:design` → data/evals/report.json）

| 指标 | 结果 |
|---|---|
| 固定案例 | 9/9 通过（预算档位、剪辑+游戏、白色外观、已有电源、商家自拟名、预算降档、非法 ID、越权字段、模型超时回退） |
| unsupported claim rate | **0**（型号/来源级别/价格三类主张全部可回溯） |
| 对抗（tests/agent/adversarial） | reason 注入、候选名注入、秘密泄露、未授权工具、promptVersion 审计 —— 全部通过 |
| grounding（tests/agent/grounding） | 每个方案项的型号/质量/价格锚定候选池与证据；无价格时 unknown —— 全部通过 |
| 可测量增益 | `measureSelectionGain`：同一 CandidateSet 上模型 vs 规则逐类价差可量化（±¥2,600 演示场景）；一侧缺失记为不可比较，不产生幻觉增益 |
| 模型关闭路径 | 无 LLM 配置时规则排序完成全流程（设计服务回归 7 例） |

## 4. Agent Runtime 决策（Phase 0）

**自研薄运行时，不引入 Pi 依赖**（详见 `docs/design/agent-harness-decision.md`）。四条硬门在 `tests/application/agent-harness-spike.test.ts` 验证通过：候选 ID-only、封闭只读工具注册表（调用前后库行数不变）、模型失败回退规则、压缩后结构化事实存活。

## 4b. Agent Runtime 与 Claim Ledger（Phase 5）

- 状态机 `received → screened → understanding → retrieved → composed → validated → answered`（`run-state.ts`），异常以 `anomaly` 事件单独记录并带 errorCode / fallback（from/to）；
- 事件审计字段：attemptId、promptVersion、model、deadline（attempt）、retrievalIds、toolCalls、fallback、errorCode；
- 工具注册表**类型级封闭**：仅 searchCatalog / searchEvidence / runCompatibilityCheck 三个只读工具（`tools/registry.ts`），无索引签名，写工具无法注册；
- Claim Ledger：七类主张（catalog/price/rule/user/experience/unknown/question），精确事实必须带来源；方案 grounding 验证器把每个方案项入账为 catalog_fact + price_fact、每条发现入账为 rule_result；price_fact 缺来源自动降级 unknown，catalog_fact 缺来源（无 canonicalId）阻塞回答；
- `design/service.ts` 已作为兼容 adapter 接入编排器：createDesignRequest 走 orchestrateDesignGeneration（UX 文案与 DesignResult 结构不变），reviseDesign 保持原路径待收敛。

## 5. 已知限制（诚实记录）

1. **增益演示依赖脚本化模型输出**：本轮评测不调用真实模型（守卫/规则路径与生产一致）；真实模型的增益数字要在接入 LLM 后用同一 harness 复测；
2. 生产库（开发库）当前只有 2 个 verified 产品，其余 26k 条 partial——**生产环境生成方案会得到"候选不足"的诚实结果**，这是质量门生效的表现而不是回归；补齐路径走证据链审核（M37 既定流程）；
3. 多方案方向（Phase 4"模型提出多个方向"）的编排留待 Phase 5 Runtime 接入后实现；
4. 排序权重（40/30/20/10/5/5）是声明式常量，尚未做敏感度评测。

## 6. 验收门禁（本轮全量）

`npm run gate:data:fixture` ✅ · `npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅（288） · `npx playwright test` ✅（55） · `npm run build` ✅
