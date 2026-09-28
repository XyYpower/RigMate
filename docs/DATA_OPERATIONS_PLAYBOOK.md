# RigMate 数据运营与审核手册

版本：1.0
适用范围：八类硬件规格、目录候选、用户未命中型号、价格证据和兼容规则数据

## 1. 数据建设的实际目标

RigMate 不追求网上所有硬件，而追求一批能支撑装机决策的高质量记录。发布一条产品记录的最低要求是：身份明确、字段明确、来源明确、可复核、不冲突、可撤回。

## 2. 八类硬件字段与来源矩阵

以下字段对应当前 src/domain/build/specs.ts。以后新增字段必须先更新这张矩阵，再更新 schema 和规则。

### CPU

字段：socket、tdpWatts。首选来源：AMD 产品页和规格 PDF、Intel ARK 产品页。审核重点：完整型号、正确代际和变体、socket 封装、TDP 与 PPT 含义。socket 没有一手证据不能用于兼容 pass，功耗含义不清时置 unknown。

### 主板

字段：socket、ramType、formFactor、ramSlots、m2Slots、sataPorts、pcieX16Slots。首选来源：ASUS、MSI、Gigabyte、ASRock 对应型号规格页和手册。不能把 M.2 支持尺寸条目数当物理槽数量，也不能把所有 PCIe 槽都算作 x16。

### GPU

字段：lengthMm、tdpWatts、pcie8pin、twelveVhpwr。芯片级功耗可参考 NVIDIA/AMD，长度和接口必须来自具体板卡厂商型号页。芯片级记录没有 lengthMm 时保持 unknown，不能用公版卡长度代表非公版卡。

### 内存

字段：ddrType、sticks。首选来源：内存厂商具体套装型号页。32G 不能自动推断为 2×16G，必须区分单条和套装。

### 存储

字段：interface。首选来源：Samsung、WD、Kioxia 等厂商型号页。M.2 形态和 NVMe/SATA 协议不能混为一谈，未纳入枚举的接口保持 unknown。

### 电源

字段：ratedWatts、pcie8pin、twelveVhpwr。首选来源：电源厂商规格页、规格书和线材表。额定功率不能用峰值替代，只有总功率而没有接口信息时接口字段 unknown。

### 散热器

字段：supportedSockets、heightMm。首选来源：散热器厂商型号页、安装手册和兼容列表。风冷高度与水冷泵头尺寸语义不同，水冷不能把泵头尺寸写入风冷限高规则。

### 机箱

字段：supportedFormFactors、maxGpuLengthMm、maxCoolerHeightMm。首选来源：机箱厂商规格页、安装手册和布局图。显卡限长受前置风扇、冷排和硬盘架影响时，必须记录条件，不能只保存一个无条件数字。

## 3. 来源网站和获取方式

允许从公开的官方产品页、规格页、用户手册和公开 PDF 进行人工或合规离线录入。每次录入保存 URL、页面标题、访问时间、内容哈希和字段摘录。常用来源包括 AMD、Intel、NVIDIA、ASUS、MSI、Gigabyte、ASRock、Kingston、G.Skill、ADATA、Samsung、WD、Kioxia 和对应机箱、电源、散热品牌官网。

域名只是来源线索，不等于每个页面都可靠，必须确认页面对应具体产品变体。

BuildCores OpenDB 作为 S2 结构化补充：用于发现型号、别名和基础字段。导入必须固定 upstream commit、保存 ODC-By 署名和审计；它不能作为价格源，也不能覆盖已经审核的 S1 字段。

参数媒体和第三方评测只用于补缺或交叉核对，记录第三方来源类型和测量口径，不自动升级为厂商事实。

价格当前只接受手动录入、用户提交凭证或授权价格接口。禁止把搜索结果摘要、模型估计、BuildCores 或未审计电商页面当成交事实。

## 4. 录入模板

每条产品字段至少包含：canonicalId、category、manufacturer、series、variant、mpn、fieldPath、value、unit、sourceType、sourceUrl、sourceTitle、sourceVersionOrCommit、capturedAt、identityMatch、evidenceExcerpt、reviewStatus、reviewer、reviewNote。

没有 fieldPath 的来源只能证明产品存在，不能证明所有字段。没有 identityMatch 的规格只能进入 partial 或 unknown。

## 5. 审核队列

建立四类队列：new_product（用户搜索到但目录没有）、missing_field（已有产品缺少规则字段）、conflict（同一字段有不同值）、stale（来源过期或链接变化）。队列记录原始输入、候选匹配、缺失字段、优先级、创建原因、处理人和结果。Agent 不得自行将队列条目发布为 verified。

## 6. 新品人工审核步骤

1. 根据用户原文和别名搜索具体产品。
2. 确认品牌、系列、变体和 MPN。
3. 打开官方型号页面或手册。
4. 只填写 schema 允许的决策字段。
5. 保存字段证据摘录和 URL。
6. 与 BuildCores 或现有记录交叉检查。
7. 运行 schema、单位、类别和重复检查。
8. 对关键字段做第二次人工复核。
9. 发布 verified、supported、partial 或 rejected。
10. 记录 data_quality_event。

## 7. 变体和合并规则

不同品牌、不同 PCB/散热器、不同长度、不同颜色型号、不同内存套装、不同接口版本和不同地区 SKU 不能合并。相同厂商相同 MPN 的大小写/空格差异、明确官方旧名与新名可以合并，但必须保留旧 ID 映射和事件记录。

## 8. 发布状态

verified：关键字段有对应具体变体的 S1/S2 证据且无未解决冲突。supported：来源可信但非一手或有少量非关键缺失。partial：可搜索和部分展示但不能支持所有规则。conflicting：来源冲突，禁止用于通过结论。stale：来源过期，禁止作为最新事实。rejected：身份或字段不可信，不进入候选。

规则引擎必须读取字段质量状态，而不是只读取 JSON 是否存在。

## 9. 更新频率

CPU socket、主板板型和内存类型在产品变更或冲突时复核；GPU 长度、供电、机箱限长和散热器高度在新品、改版或用户纠错时复核；价格每条快照独立过期；来源链接定期检查可达性和内容哈希；高搜索高阻塞条目优先审核。

## 10. 数据发布前检查

每个批次输出新增、更新、合并、拒绝和冲突数量；各类关键字段完整率；字段证据覆盖率；重复率；来源链接失败数；schema 和单位错误数；与上一版本的字段变化；抽样人工复核结果。来源缺失、关键字段静默覆盖或冲突增加但未解释时，批次不能发布。

## 11. 当前代码的改造落点

数据库新增 product_sources、product_field_evidence、data_quality_events、pending_catalog_queue，并扩展 canonical_products 的 manufacturer、series、variant、mpn、quality_status、source_version 和 updated_at。

Domain 新增字段质量状态、来源等级、证据覆盖率和冲突合并纯函数。规则引擎在字段状态为 unknown、conflicting 或 stale 时返回 unknown。

Import 扩展 src/infra/catalog-import/run.ts 和 map.ts，把 upstream commit、字段映射、导入批次和来源摘要写入审计，禁止无来源创建新品。

Application 新增 catalog review service，提供创建待审核、接受字段、驳回、合并、标记过期和发布批次操作。UI 先做只读质量报表和待审核列表，再做编辑表单。

## 12. 最小可行数据计划

第一批不要导入几十万条，先建设 100–300 个高频且能被官方资料复核的产品变体：常用 CPU 和主板组合、常见显卡具体品牌变体、常见机箱和电源、常见风冷、常见内存套装和 NVMe 固态。每条先补齐影响兼容的字段，价格另行维护。

## 13. 对外表达

产品不写“100% 准确”“全网最低价”“权威数据库”。建议显示：规格来源、已核验字段数量、待补充字段、价格地区/渠道/日期、兼容规则和未知项。可信来自可复核过程，而不是口号。
