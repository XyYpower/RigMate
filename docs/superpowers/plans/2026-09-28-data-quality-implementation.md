# RigMate 数据质量系统实施计划

目标：把现有 canonical_products、BuildCores 导入和 price_evidence 扩展为字段级来源、质量状态、审核队列和可发布批次。

## Task 1：扩展数据契约

文件：src/contracts/catalog.ts、src/domain/catalog/quality.ts、tests/domain/catalog-quality.test.ts。

- [ ] 定义 SourceTier、FieldQualityStatus、EvidenceStatus、ReviewQueueType。
- [ ] 定义 ProductSource、ProductFieldEvidence、DataQualityEvent、PendingCatalogItem schema。
- [ ] 为 canonical product 增加 manufacturer、series、variant、mpn、qualityStatus、sourceVersion。
- [ ] 测试空字段、冲突字段、过期状态、错误单位和不匹配变体。

## Task 2：数据库迁移和仓储

文件：src/infra/db/migrate.ts、src/infra/db/client.ts、src/infra/db/repositories/catalog-repository.ts、新增 evidence-repository.ts、quality-repository.ts、tests/infra/catalog-quality.test.ts。

- [ ] 新增 product_sources、product_field_evidence、data_quality_events、pending_catalog_queue 表。
- [ ] 为 canonical_products 增加身份和质量列。
- [ ] 所有迁移幂等，保存 schema_version 和批次时间。
- [ ] 仓储支持按字段读取证据、按状态筛选产品、追加质量事件和读取待审核队列。
- [ ] 测试迁移重跑、数据重启持久化、冲突不覆盖和队列状态流转。

## Task 3：导入器来源审计

文件：src/infra/catalog-import/run.ts、map.ts、load.ts、tests/infra/catalog-import.test.ts、scripts/catalog-quality-report.ts。

- [ ] 导入记录保存 upstream commit、许可证、来源路径、字段映射和内容哈希。
- [ ] 只有带来源和身份匹配的字段才能写入 supported 或 verified。
- [ ] 导入只能补缺，不能静默覆盖已有 S1 字段。
- [ ] 同一 canonicalId 的字段冲突写入 quality event 并降低状态。
- [ ] 输出批次报告：新增、更新、拒绝、冲突、缺字段、来源失败和抽样结果。

## Task 4：人工审核服务

文件：src/application/catalog-review/service.ts、src/app/api/catalog/review/route.ts、src/app/api/catalog/queue/route.ts、tests/application/catalog-review.test.ts。

- [ ] 支持创建 new_product、missing_field、conflict、stale 队列项。
- [ ] 支持审核字段、添加来源、驳回、合并、标记过期和发布批次。
- [ ] 所有写入记录 reviewer、reason、before、after 和 createdAt。
- [ ] Agent 无权直接发布 verified。

## Task 5：规则引擎接入质量状态

文件：src/domain/rules/engine.ts、src/domain/rules/helpers.ts、tests/domain/compatibility-rules.test.ts。

- [ ] 规则读取字段值和字段质量状态。
- [ ] unknown、conflicting、stale 字段返回 unknown，不返回 pass。
- [ ] Finding 中包含 ruleId、涉及字段、来源状态和缺失原因。
- [ ] 增加 GPU 长度、机箱限长、电源连接器和水冷高度的质量回归测试。

## Task 6：目录质量报表

文件：src/domain/catalog/overview.ts、src/app/hardware/page.tsx、src/app/api/catalog/overview/route.ts、tests/e2e/catalog-quality.spec.ts。

- [ ] 显示每类产品数量、关键字段完整率、证据覆盖率、冲突率和过期率。
- [ ] 显示 BuildCores、人工目录和厂商来源的分层计数。
- [ ] 显示待审核队列数量和阻塞最多的字段。
- [ ] 先做只读报表，不在前端直接修改产品事实。

## Task 7：首批高质量目录

- [ ] 选择 100–300 个高频具体变体，不追求全量。
- [ ] 每条补齐会影响兼容的决策字段和官方来源。
- [ ] 对 CPU/主板、GPU/机箱、GPU/电源、散热/机箱做重点交叉审核。
- [ ] 运行全量 schema、规则和检索评测。
- [ ] 记录首批数据基线，冻结后才能衡量后续质量变化。

## Task 8：价格证据隔离

文件：src/contracts/price.ts、src/infra/db/repositories/price-evidence-repository.ts、src/app/evidence/page.tsx、tests/infra/price-evidence.test.ts。

- [ ] 价格记录绑定 canonicalId、地区、渠道、日期、条件、来源类型和审核状态。
- [ ] 价格不写入规格 verified 状态。
- [ ] 过期价格仍可查看，但方案估算必须显示日期和非实时提示。
- [ ] 用户提交凭证和人工录入可以进入审核队列。

## Task 9：数据发布门禁

- [ ] 运行 npm run typecheck、npm run lint、npm test。
- [ ] 运行目录导入、质量报表、规则和检索测试。
- [ ] 检查没有无来源 verified 字段。
- [ ] 检查冲突和过期字段没有被规则标记 pass。
- [ ] 检查批次报告已保存，能够回滚到上一版本。
