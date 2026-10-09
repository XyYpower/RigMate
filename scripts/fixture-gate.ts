import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { runDataReleaseGate } from "./data-release-gate";
import { seedCatalogFixtureIntoDb } from "../src/infra/catalog-import/fixture";
import { ensureDatabase, closeDatabase } from "../src/infra/db/client";

/**
 * fixture 数据门禁（内核恢复计划 Task E）：
 * 1. 从零建 data/fixture.db（schema v11 + fixture 池：supported 目录 + 已审核价格证据）；
 * 2. 跑 G1–G6 全部门禁（fixture 也必须过门禁——supported 不越 verified 红线）；
 * 3. 反向断言：空库必须被判为"未发布"（G5 失败），空生产库不能自动算已发布。
 */

const FIXTURE_DB = resolve("data/fixture.db");
const EMPTY_DB = resolve("data/fixture-empty.db");

for (const path of [FIXTURE_DB, EMPTY_DB]) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

try {
  // 1+2. 建库 → 种 fixture → 门禁
  process.env.RIGMATE_DB_PATH = FIXTURE_DB;
  ensureDatabase();
  const seeded = seedCatalogFixtureIntoDb();
  closeDatabase();
  console.log(`fixture 库已建立：${seeded.insertedEntries} 条目录 / ${seeded.priceEvidenceCount} 条已审核价格证据\n`);
  const results = runDataReleaseGate(FIXTURE_DB);
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`fixture 门禁失败：${failed.map((result) => result.id).join("、")}`);
    process.exit(1);
  }

  // 3. 空库必须不通过（G5 无导入批次）——"空库 = 已发布"是被禁止的判定
  process.env.RIGMATE_DB_PATH = EMPTY_DB;
  ensureDatabase();
  closeDatabase();
  const emptyResults = runDataReleaseGate(EMPTY_DB);
  const g5 = emptyResults.find((result) => result.id === "G5");
  if (!g5 || g5.ok) {
    console.error("反向断言失败：空库竟然通过了 G5（空生产库不能被判成已发布）");
    process.exit(1);
  }
  console.log("\n反向断言通过：空库被 G5 正确拒绝。");
  console.log("fixture 数据门禁全部通过。");
} finally {
  rmSync(EMPTY_DB, { force: true });
  rmSync(`${EMPTY_DB}-wal`, { force: true });
  rmSync(`${EMPTY_DB}-shm`, { force: true });
}
