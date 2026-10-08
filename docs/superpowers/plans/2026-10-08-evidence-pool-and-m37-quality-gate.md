# 证据池收口 + M37 质量门（移交执行计划）

日期：2026-10-08 ｜ 移交自：数据质量窗口（已完成 Task 1-9 代码 + 六批查证 + 首次人工复核）
性质：窄任务。**不扩展 UI、不引入完整 Agent 编排、不改产品路线**。完成后才进入完整 M37 评测与发布判断。

## 0. 必读

1. `docs/AI_COLLABORATION.md`（§0 交接快照 + §环境备忘：**dev 环境依赖 `allowedDevOrigins`，勿删**）
2. `docs/DATA_PROVENANCE_AND_QUALITY.md` §3 来源等级、§6 字段真实性四维
3. `docs/superpowers/plans/2026-09-28-data-quality-implementation.md`（已完成，本计划是其延伸）

## 1. 现状快照（2026-10-08，schema v10）

- **已核验**：酷里奥 A60（cooler）、七彩虹火神 4080S（gpu）= 全库仅有的 2 个 verified 产品
- **partial**：其余 12 个有人工证据的产品（GRE/冰猎鹰/B650M K/B840M/X870 冰雕/B850 小雕/B850M FORCE/MVP K850/WD750Evo/VTE X2/FX850/FV160）+ 2.6 万条 BuildCores
- **管道现状（本任务要接的两根管子）**：
  - `src/domain/design/proposal.ts:176`：`sourceLevel` **硬编码 `"verified_catalog"`**——所有候选（含 2.6 万条 partial）都被冒充为已核验目录；
  - `BuildItem.fieldQuality`（`src/domain/build/types.ts`）+ 规则质量门（`src/domain/rules/helpers.ts` `gateFieldQuality`，12 条规则已装）**没有任何上游喂参**——`computeProductFieldStatuses`（`src/application/catalog-review/service.ts`）能算出每产品逐字段状态，但生成方案/接受方案路径没有调用它；
  - 可用基础设施：`computeProductFieldStatuses`（逐字段状态+采用值）、`isRuleUsable`、`listCatalogRecords({qualityStatus})`、`SourcedCatalogEntry.qualityStatus`、审核台（/review）、`npm run gate:data`。

## 2. 任务范围（对应用户六点指令）

### Task A：候选池质量门（方案生成侧）

文件：`src/domain/design/proposal.ts`、`src/application/design/service.ts`、`src/infra/catalog-import/load.ts`。

- 候选只允许 `qualityStatus ∈ {verified, supported}`；`partial/conflicting/stale/rejected/merged` 一律不进方案候选（merged 已在读取层过滤，conflicting/stale 按 `quality_status` 过滤）。
- `ProposalItem.sourceLevel` 按真实状态映射：verified → `verified_catalog`；supported → **新增枚举 `supported_catalog`**（`src/contracts/design.ts`，UI 文案「已核验目录 / 有参考资料目录」）；partial 及以下不得进入候选。
- 候选不足八类时的降级策略要诚实：宁缺毋滥，缺类别在 `unknowns` 里明说，不从 partial 里凑数。

### Task B：方案项携带质量信息（接受方案侧）

文件：`src/contracts/design.ts`、`src/domain/design/proposal.ts`、`src/application/design/service.ts`（accept 路径）、`src/application/builds/service.ts`。

- `ProposalItem` 增加可选 `fieldQuality?: Record<string, FieldQualityStatus>` 与 `evidenceSourceIds?: string[]`（真实来源 ID 引用，不发明）。
- 接受方案 → `addBuildItem` 时把 `fieldQuality` 带到 `BuildItem`，让 12 条规则的 `gateFieldQuality` 真正生效（当前是空转）。
- 回归：verified 字段冲突（如来源被驳回转 stale）后，旧方案的检查结果要能变 unknown。

### Task C：最小候选池（数据侧，八类各 ≥1 个 verified/supported）

现状：gpu/cooler 已达标。**优先补齐存量 partial 产品的缺字段**（比新查省力，字段多半是官网规格页一行的事）：

| 产品 | 缺口（无证据的必填字段） |
|---|---|
| 技嘉 X870 冰雕 | socket / ramType / formFactor |
| 技嘉 B840M FORCE | socket / ramType / formFactor |
| 技嘉 B850 小雕 | socket / ramType / formFactor |
| 技嘉 B650M K | socket / ramType / formFactor / ramSlots / pcieX16Slots |
| 航嘉 MVP K850 | ratedWatts |
| 航嘉 WD750Evo | ratedWatts |
| 骨伽 VTE X2 750 | ratedWatts |
| 骨伽 FV160 | supportedFormFactors（官网图已确认 M-ATX/ITX，补录即可） |
| 技嘉 GRE / 冰猎鹰 | tdpWatts |

渠道纪律沿用：官网浏览器直读 > ZOL 参数页（S3）> 用户截图；认证等级不得推断接口；录入走审核链（`addReviewSource`/`addReviewEvidence` → 用户盖章 → `publishProduct`）。若某类实在补不满，允许该类留空并在评测里记"候选不足"，不硬凑。

### Task D：真实目标样本评测

文件：新增 `src/domain/design/evaluation.ts`（或 tests 侧等价物）+ `tests/domain/design-quality-gate.test.ts`。

用例至少覆盖：
1. 非法/不存在型号（"RTX 5090Ti Ultra Plus"）→ 不命中候选、不编造；
2. 商家自拟名（"无界PRO 750W"）→ 不跨类别误命中；
3. 候选缺字段 → 方案项如实 unknown + confirmationRequired，规则输出 unknown 而非 pass；
4. 冲突字段（人为构造 conflicting）→ 不进候选；
5. 全部候选被质量门过滤后 → 诚实输出"该类暂无已核验候选"，而不是回退到 partial；
6. LLM 选件失败/超时 → 回退规则式分档（对接 `intent-llm.ts` 既有降级模式），活动流如实标注。

### Task E：门禁与交付

- `npm run gate:data`（typecheck+lint+test+数据门禁）+ `npm run test:e2e` 全绿；E2E 不新增 UI 断言（本任务不改 UI）。
- 更新 `AI_COLLABORATION.md` 版本记录 + push。

## 3. 红线（违反即返工）

1. 不得把 partial/conflicting/stale 冒充 `verified_catalog`——包括 UI 展示语义。
2. 不得为凑池子放宽证据要求（认证等级推断接口、聚合值直接当一手，均为红线）。
3. 规则 unknown 纪律不得松动：质量状态不可用的字段永远不得 pass。
4. 不动六区导航与 UI 窗口在途文件；契约变更（sourceLevel 枚举）需在本文件登记后实施。

## 4. 验收口径

- 一份"2 万预算白色海景房剪辑+3A"目标生成的方案中，每个方案项都能回答：候选来自哪个质量状态、来源 ID 是什么、哪些字段已核验/待补充——且没有一项 partial 被标成已核验。
- `catalog:quality` 报告显示八类中至少 6 类存在 verified/supported 候选（cpu/mb/ram/storage/psu/case 中允许最多 2 类空缺，须如实记录）。
