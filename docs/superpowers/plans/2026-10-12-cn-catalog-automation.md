# 中国大陆硬件自动目录同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动从中国大陆公开厂商产品页发现并导入主流硬件目录，第一条切片覆盖华硕/ROG 主板。

**Architecture:** 新增来源适配器，负责索引页链接发现、详情页快照和类别字段解析；复用现有 `CatalogEntry`、schema 校验和目录导入服务。自动导入按必填字段完整度写入 `supported` 或 `partial`，抓取失败只写报告；价格作为独立的未审核快照保存。

**Tech Stack:** TypeScript、Node fetch、Vitest、Zod、现有 SQLite/目录导入层。

---

### Task 1: 固定华硕产品页解析契约

**Files:**
- Create: `tests/catalog/cn-source-adapter.test.ts`
- Create: `src/infra/catalog-import/cn/asus.ts`

- [x] **Step 1–4:** 已完成 JSON-LD 身份、主板规格、价格、链接发现和无身份页面拒绝测试与实现。

### Task 2: Add mainland source types and automatic catalog import

**Files:**
- Modify: `src/infra/db/repositories/catalog-repository.ts`
- Modify: `src/contracts/catalog.ts`
- Modify: `src/infra/catalog-import/db-import.ts`
- Create: `src/infra/catalog-import/cn/types.ts`
- Create: `src/infra/catalog-import/cn/import.ts`
- Test: `tests/catalog/cn-source-import.test.ts`

- [x] **Step 1–4:** 已完成 `manufacturer_cn` 目录导入、MPN 稳定 ID、字段完整度质量状态、来源/证据/价格快照和重复同步测试。

### Task 3: Add a live sync command with safe snapshots

**Files:**
- Create: `scripts/sync-cn-catalog.ts`
- Modify: `package.json`
- Create: `tests/catalog/cn-sync.test.ts`
- Create: `data/catalog/cn-sources.json`

- [x] **Step 1–3:** 已完成链接发现、数量限制、失败报告、哈希快照和 `--live/--write` 命令。
- [x] **Step 5:** `npm run typecheck`、`npm run lint`、`npm test` 和 `npm run build` 已通过。
- [ ] **Step 4:** 真实同步依赖目标站点可访问；当前环境本次请求返回 `fetch failed`，此前已验证过公开页面样本。

### Task 4: Document the first mainland source and verification

**Files:**
- Modify: `README.md`
- Modify: `docs/DATA_SOURCE_ACQUISITION_DESIGN.md`

- [x] **Step 1–2:** 已记录命令、来源边界、质量状态、价格隔离和限制，并通过 lint/typecheck。
- [x] **Step 3:** 已在前次可访问环境验证公开样本；本次网络不可用已如实记录。
