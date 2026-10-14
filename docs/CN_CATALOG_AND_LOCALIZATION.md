# 大陆目录采集与中文展示层

> **本文档是「数据采集 + 中文展示」这条工作线的独立交接文档。**
>
> 与 [AI_COLLABORATION.md](./AI_COLLABORATION.md) 的关系：那一份是全项目的进度锚点，
> 本文档只负责这一条线，**可以独立阅读、独立更新**。两个 AI 并行开发时互不覆盖。
>
> 最后更新：2026-10-13 ｜ 状态：管道可信，源数据不足以喂饱质量门（见 §4 硬结论）

---

## 0. 一句话现状

数据采集管道已经**端到端跑通且可信**（官方来源 → 字段级证据 → 质量门），但
**中国大陆厂商官网愿意公开的字段，不足以让产品通过质量门**。缺口不在技术，在数据源。

---

## 1. 这条线做了什么

| 模块 | 位置 | 作用 |
|---|---|---|
| 中文名本地化 | `src/domain/catalog/localization.ts` | 厂商中文名推导 + 参数截断 + 撞车回退 |
| 展示名解析 | `src/infra/catalog-import/display-names.ts` | catalogId → 中文展示名索引 |
| 采集适配器契约 | `src/infra/catalog-import/cn/contract.ts` | 多品牌共用的「发现/抓取/身份/字段」四段式 |
| 规格字段映射 | `src/infra/catalog-import/cn/spec-parsers.ts` | 八大类中文/英文标签 → schema 字段（**全品牌共用**） |
| 微星适配器 | `src/infra/catalog-import/cn/msi.ts` | msi.cn 采集（仅主板 + 机箱，见 §3） |
| 通用落库通道 | `src/infra/catalog-import/cn/import.ts` | 多品牌共用，与华硕同一条证据链 |
| 采集 CLI | `scripts/collect-cn-catalog.mts` | 默认 dry-run，`--write` 才落库 |
| 报表 | `npm run catalog:i18n` / `npm run catalog:duplicates` | 中文覆盖率、重复行审计（只读） |

---

## 2. 中文展示层：设计红线

**中文名是展示层，不是事实层。** 违反这条会直接污染质量门。

- `name` / `label` **一个字符都不改写**——它是身份与证据链的锚
- **规格字段永不翻译**：AM5 / DDR5 / ATX / 650W 是标准值，翻译即制造错误
- 厂商中文名只收大陆零售市场通用写法（`localization.ts` 的 `VENDOR_NAME_ZH`，44 条）
- **系列昵称（吹雪/猛禽/魔爪）一律不猜**：官网产品名里没有就不写。
  依据：微星中国站 `GAMING TRIO` 的中文名"魔龙"只出现在**营销文案**里，产品标题是英文；
  把"魔龙"拼进产品名属于**构造**而非**转写**。
- 中文名缺失时回退英文原名，**不留空白**（诚实降级）
- 界面只显示中文名，英文原名进 `title` 悬停

### 参数截断的安全规则

BuildCores 的 name 是「营销名 + 参数堆叠」，且参数**插在中间**不只挂尾部，所以做**截断**而非剥离。
截断点判错只会丢后缀，剥离判错会把型号中间挖空。

三条安全阀（都是实测踩出来的）：

1. **短促大写片段守卫**：保留部分末尾若是 ≤2 字符纯大写（`N`/`GM`/`ZS`）且型号段已仅剩 ≤2 token，
   判定为「功率被切断的型号代号」（`LEPA N500` → `LEPA N`），放弃本次截断
2. **取值合理区间**：显卡长度下限 140mm（`43 x 112 x 20 mm` 是高度三围，不是长度）；越界即丢弃
3. **同类别撞车回退**：截断后撞车的条目自动放弃截断——`金士顿 FURY Beast 32GB` 与
   `16GB` 会被截成同一个名字，用户无从分辨。**可读性不能以"分不清产品"为代价。**

---

## 3. 大陆官网采集：现状与边界

### 可行性已验证

- 微星中国站 `robots.txt` 明确 `Allow: /` + `Content-Signal: search=yes, ai-input=yes`
- 自带 `sitemap.xml`，产品 sitemap 1528 个 URL
- 老款产品页**服务端渲染**，`ul#itembox`（标签）与 `#pdtb .tr`（值）可按索引精确配对

### 已开启的类别（已对真实页面核验）

`msiAdapter.categories = ["motherboard", "case"]`

```bash
npm run catalog:collect-cn -- --vendor msi --category case --limit 6          # dry-run
npm run catalog:collect-cn -- --vendor msi --limit 200 --write                # 落库
```

实测：200 页主板 → 解析成功 200，**必填齐全 12**；机箱 14 条 → 齐全 13（93%）

### 未开启的类别，及阻塞原因（查证结论，非"没做完"）

| 类别 | 缺什么 | 官网实测结论 |
|---|---|---|
| **显卡** | `tdpWatts` | msi.cn 规格页**没有** TDP / 功耗 / Board Power，只有「建议电源 (W)」——那是推荐电源功率，不是显卡功耗。拿它填 TDP 会直接污染供电余量规则 |
| **电源** | `pcie8pin` / `twelveVhpwr` | 规格页内**连** 8pin / 12VHPWR / 线材 / 额定功率都没有 |
| **散热器** | `heightMm` | 插槽能拿到（需合并 Intel/AMD 两行），该系列页面没有散热器高度 |
| **存储** | — | 规格页结构与主板不同（无 itembox 双栏），接口字段要从另一套结构取 |

### 重要更正：新型号在 msi.cn 上是 404

```
[Motherboard/MAG-B760M-TOMAHAWK-WIFI/Specification] → 404 Not found
[Motherboard/MPG-X870E-EDGE-DDR5/Specification]    → 404 Not found
[Motherboard/A520M-PRO/Specification]               → 200, 62831B, 完整规格表
```

**AM5 新款（X870E / B850 / Z890）没有在中文站发布**，因此**不存在可逆向的接口**。
需要的主力型号（9800X3D / 4070S 配的主板）恰恰在这一批里。

---

## 4. 硬结论：爬虫这条路的天花板

采集到的 203 条微星主板实测：

```
socket  解析成功 39 / 203     ← 质量门硬要求
ramType 解析成功 12 / 203     ← 质量门硬要求
七项齐全 12 / 203
进候选池 supported 15 条，其中 AM5/DDR5 = 0
```

原因：主板质量门要求 7 个字段全齐，而 `socket` / `ramType` 只能从**老页面形态**解析出来。

**结论：管道是可信的，但源头给不出够用的数据。**
爬虫拿不到价格（msi.cn 不公开售价），所以**即使规格补齐，预算排序依然激活不了**。

---

## 5. 数据质量事故记录（已修，供后人参考）

采集过程中真实出现过的、会污染数据的错误——全部由"全量审计 + 实网核验"发现，抽样看不出来：

| 问题 | 现象 | 根因 | 修法 |
|---|---|---|---|
| PCIe 数量误读 | `pcieX16Slots: 16` | 靠文本邻近猜标签/值对应，把 "PCI-E X16" 的 16 当数量 | 按 `ul#itembox` ↔ `#pdtb .tr` 索引配对 |
| 三围当长度 | `lengthMm: 40` | "267 x 111 x 40 mm" 单位只写末尾，取了贴着单位的数 | 三围取第一个数 |
| 括号被吞 | `sticks: undefined` | 归一化把 `(2 x 16GB)` 整段删掉 | 只剥 `(mm)`/`(W)` 这类纯单位标记 |
| 供电数错 | `8-pin x 1` → 8 个 | 假设"数量在前"，微星是"规格在前" | 两种写法都认 |
| 插槽漏一半 | 只拿到 LGA1700 丢 LGA1851 | Intel/AMD 分两行只取了第一行 | 数组合并；裸数字承接 LGA 前缀 |
| SEO 尾巴 | 42 条名字带 `｜Best Motherboard for AI PC｜MSI` | 页面标题含营销文案 | 剥 `\|`/`｜` 之后的全部 |
| 系列页重名 | B550×10、B460×7 | 芯片组系列页多型号共用一个标题 | slug 更具体时以 slug 为准（子串判定） |

修复脚本：`npm run catalog:duplicates`（只读审计）、`scripts/repair-cn-names.ts`（修名，默认 dry-run）

---

## 6. 给下一个接手的人

1. **先读 §2 和 §4 再动手**——§4 的结论会决定你要不要继续投入
2. **新增品牌只需实现 `VendorAdapter` 四段式**，规格字段映射复用 `spec-parsers.ts`
3. **没核验的类别不要写进 `categories`**——宁可少覆盖一类，也不产出带 S1 标记的错值
   （错值会通过质量门去驱动兼容规则，比缺字段危险得多）
4. **写库前先备份**：`data/rigmate.db.bak-*`
5. **不要依赖逆向接口**：项目红线是「生产同步使用固定适配器，不在每次运行中依赖逆向工具」；
   且已验证 msi.cn 新型号是 404，没有接口可逆向
6. **真正的缺口是价格**：`price_evidence` 仅 6 行、verified 0 行，
   这是产品"看起来没效果"的根因，官网采集解决不了