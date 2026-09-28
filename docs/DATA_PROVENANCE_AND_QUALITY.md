# RigMate 数据来源、真实性与质量体系

**版本：** 1.0  
**日期：** 2026-09-28  
**目的：** 解决硬件规格、兼容性、价格和用户输入分别从哪里来，以及如何证明每个字段真实、准确、可追溯

## 1. 先接受一个事实：不存在万能权威源

RigMate 不应该寻找一个“所有数据都最权威”的数据库。不同事实有不同的最佳来源：

| 事实 | 第一来源 | 第二来源 | 不应作为最终依据 |
|---|---|---|---|
| CPU/GPU 官方规格 | AMD、Intel、NVIDIA 官方产品页和规格书 | 官方 PDF、官方开发者文档 | 论坛、模型记忆 |
| 主板插槽、板型、内存支持 | 主板厂商产品页、规格页、用户手册 | 厂商 CPU 支持列表、BIOS 支持页 | 电商标题、论坛猜测 |
| 显卡长度、槽位、供电接口 | 显卡具体厂商型号页、安装手册 | 可信参数站作为补充 | 只看 GPU 芯片公版参数 |
| 机箱显卡限长、散热器限高 | 机箱厂商规格页和手册 | 可信参数站、用户实测并标注 | 商品宣传图推断 |
| 电源功率和连接器 | 电源厂商规格页、规格书 | 可信评测拆解 | 电商标题 |
| 硬件身份和别名 | 厂商 MPN、官方型号 | BuildCores OpenDB、人工维护目录 | 模糊名称 |
| 价格 | 用户提交的购买凭证/手动录入 | 官方联盟 API 或授权报价接口 | BuildCores、模型估算、未审计网页 |
| 用户预算和用途 | 用户明确输入 | 后续修订确认 | 模型猜测 |

“权威”必须落实到字段。例如一张显卡的芯片型号可以由 NVIDIA 官方资料支持，但具体 MSI/Ventus 版本的长度只能由 MSI 对应型号页支持。字段不能跨产品变体借用。

## 2. 数据分层

### 2.1 Canonical Product

系统识别的一个具体产品变体，必须有稳定 canonicalId、厂商、系列、MPN 或可验证型号。不能把 RTX 4070 Super 芯片系列和 MSI Ventus 3X RTX 4070 SUPER 16G 显卡变体混成一条记录。

### 2.2 Decision Specs

只保存会影响装机决策的字段，例如 socket、formFactor、memoryType、lengthMm、heightMm、tdpW、powerConnectors、interface 和 capacity。字段为空就是 unknown，不能用系列平均值填充。

### 2.3 Evidence Record

每个字段可以有多个证据。证据记录来源 URL、来源类型、页面标题、抓取/录入时间、内容摘要、字段路径、来源版本、审核人和状态。

### 2.4 Derived Fact

规则引擎从多个事实计算出的结论，例如“显卡长度超过机箱限制”。Derived Fact 必须保存输入字段快照、规则 ID、规则版本和计算时间。

## 3. 来源等级

### S0：用户明确输入

只证明“用户这样说过”，不证明硬件事实。用户输入的型号进入待核验队列，不能自动标记 verified_catalog。

### S1：厂商一手资料

品牌官网产品页、规格页、用户手册、数据表、官方 CPU 支持列表、官方 BIOS/兼容列表。对于对应变体和字段，S1 是最高规格来源。

### S2：授权或可信结构化来源

BuildCores OpenDB、公开数据集、可信参数接口。BuildCores 有 ODC-By 许可证和 schema 校验，适合做候选和补充，但项目自身也声明不提供价格；S2 不能覆盖已核验的 S1 字段。

### S3：专业第三方资料

可信评测、实验室实测、公开参数媒体。只能支持它实际测量或明确记录的字段，必须保存来源和时间；不自动升级为厂商事实。

### S4：用户提交和人工录入

用户购买凭证、包装/铭牌照片、人工查证。可用于价格和本地 SKU，但需要审核状态和凭证摘要。

### S5：模型经验

只能用于用途建议和取舍说明，不能用于精确规格、价格、尺寸、接口或兼容结论。

## 4. 字段级证据模型

建议新增以下表或等价结构：

### product_sources

- id
- canonical_product_id
- source_type：manufacturer、manual、buildcores、parameter_media、user_submission、price_evidence
- source_url
- source_title
- source_version 或 upstream_commit
- license
- captured_at
- content_hash
- status：unreviewed、verified、conflicting、stale、rejected
- reviewer_note

### product_field_evidence

- id
- canonical_product_id
- field_path，例如 spec.lengthMm
- value_json
- evidence_id
- source_quote 或 normalized_excerpt
- confidence：high、medium、low
- verified_at
- verified_by
- supersedes_id

### data_quality_events

- id
- canonical_product_id
- event_type：imported、reviewed、corrected、conflict、deprecated、merged
- before_json
- after_json
- reason
- actor
- created_at

价格继续使用追加式 price_evidence，但要增加 product/canonical ID、来源类型、凭证或链接摘要、地区、条件、capturedAt 和审核状态。

## 5. 数据进入系统的流程

### 5.1 新产品录入

1. 收集厂商名称、完整型号、MPN 或官方链接。
2. 建立 canonical product 草稿。
3. 从官方页面或手册提取决策字段。
4. 每个字段绑定证据，而不是给整行打一个总可信度。
5. 与已有 canonical product 做重复和变体检查。
6. 运行类别 schema 和字段单位校验。
7. 人工审核关键字段：插槽、板型、长度、高度、功耗、连接器。
8. 发布为 verified、partial 或 unverified。

### 5.2 公开数据导入

BuildCores 等来源只走离线导入器：固定 upstream commit、保存许可证和导入审计、映射字段、校验 schema、标记来源、只填缺失字段、不静默覆盖 S1、不静默创建新品。导入后抽样核对关键类别，失败记录必须阻止发布。

### 5.3 用户型号未命中

不让模型猜一个相似型号替代。进入 pending_catalog_queue，保存用户输入、可能匹配候选、需要确认的字段和来源搜索任务。用户可以继续 DIY，但涉及未知字段的规则输出必须是 unknown。

## 6. 真实性判断不是一个布尔值

每个字段使用四个维度：sourceTier、identityMatch、freshness、consistency。

字段状态建议：verified、supported、partial、conflicting、stale、unknown、rejected。

只有 sourceTier 为 S1/S2 且 identityMatch 明确、无冲突的字段才能显示“已核验”。有来源但变体不明确只能显示“有参考资料”。

## 7. 冲突处理

当来源冲突时：不静默覆盖旧值；保存所有证据和来源时间；比较产品变体、地区版本、测量口径或单位转换差异；S1 对应同一变体优先于 S2/S3，但仍保留冲突事件；无法判断时字段置为 conflicting/unknown；兼容规则遇到 conflicting 或 unknown 时不能输出 pass；前端显示“资料冲突，需要确认”。

## 8. 价格数据的特殊边界

规格真实性和价格真实性必须分开。价格随地区、平台、时间、库存、版本和促销变化，不能把一次价格录入当成产品事实。

当前阶段建议：方案页只显示经验估算区间并明确“非实时成交价”；用户手动录入或提交购买凭证时记录实际价格、日期、地区、渠道和条件；未来接入实时价格只使用授权联盟 API 或正式授权数据源并保存快照；不抓取京东、淘宝等平台的登录态或绕过反爬数据；没有价格证据时显示 unknown。

## 9. 如何向用户证明“这是真的”

不是展示一个“权威”徽章，而是让用户看到字段级依据：型号和关键规格来源、来源类型和日期、是否对应具体变体、价格的地区/渠道/日期/条件、兼容结论使用的规则和输入字段、是否存在未知或冲突。UI 默认显示简短结论，点击“查看依据”展开来源卡。证据卡不能把模型理由冒充来源。

## 10. 质量控制指标

目录质量：关键字段完整率、字段级证据覆盖率、重复产品率、变体误合并率、冲突率、过期率。检索质量：型号 Recall@20、别名 Recall@20、空结果准确率、类别误召回率。规则质量：unknown 被误判 pass 的数量、冲突被误判 pass 的数量、规则回归通过率。价格质量：带证据价格占比、过期价格占比、用户纠错率。

关键字段的证据覆盖率达不到门槛时，不发布为 verified。指标先建立基线，再由真实样本冻结阈值。

## 11. 你现在最应该采用的数据策略

第一阶段不要追求全量硬件。建立高频、可核验的小目录：CPU、主板、GPU、机箱和电源各挑常见型号，优先补齐会影响兼容的字段。每条记录保存官方来源和审核记录，缺字段就 unknown。

第二阶段把 BuildCores 作为开源结构化补充和候选发现工具，用它扩充别名和基础字段，但不把它当价格来源，也不把所有字段自动标为官方已核验。

第三阶段建立人工审核队列：用户未命中型号、字段冲突、过期证据和高频搜索缺失优先进入队列。人工每次只审核少量关键字段，效率比一次性导入几十万条不确定数据更高。

第四阶段再接入授权价格或联盟数据。价格是独立项目，不要和规格库混在一起。

## 12. 对当前 RigMate 的具体判断

当前已有的 BuildCores 导入器、ODC-By 署名、canonical_products、自有种子目录和 price_evidence 是正确方向；需要继续补强的是字段级 evidence、产品变体身份、冲突状态、人工审核队列和数据质量报表。

当前最危险的误区是：目录里有一条 JSON，就把整条记录当成真实准确；或者模型能说出型号，就把它当成存在。正确做法是字段级来源、具体变体匹配、规则重算和 unknown 纪律。

## 13. 数据建设实施顺序

1. 为 canonical_products 增加字段级 evidence 和 qualityStatus。
2. 为导入器增加来源版本、内容哈希、冲突和抽样报告。
3. 建立 pending_catalog_queue 和人工审核页面/脚本。
4. 建立关键字段完整率和证据覆盖率报表。
5. 建立型号、别名、错别字和无结果检索评测集。
6. 让 Agent 只读取 verified/supported 字段，并对 partial/conflicting/stale 降级。
7. 让兼容规则读取字段质量状态，unknown 不得通过。
8. 价格继续独立维护，未来再接授权接口。

## 14. 最终判断标准

RigMate 不需要宣称“所有数据绝对正确”。它需要做到：用户知道结论来自哪里；系统知道字段是否对应具体型号；过期、冲突和缺失不会被隐藏；规则只基于已知字段判断；任何人都能通过来源、时间、版本和审核记录复核。

这才是一个装机 Agent 可以长期建立信任的数据体系。
