import { rmSync } from "node:fs";

/**
 * E2E 专用：测试运行前重置隔离数据库并种入 fixture 池（内核恢复计划 Task E）。
 * 不触碰开发库 data/rigmate.db。
 *
 * 为什么必须种 fixture：质量门（verified/supported）之后，空库的诚实结果是
 * "无候选 → 追问"，E2E 的方案主链路需要一组质量达标候选 + 已审核价格证据。
 */

const dbPath = process.env.RIGMATE_E2E_DB_PATH ?? "./data/e2e.db";
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

async function main(): Promise<void> {
  process.env.RIGMATE_DB_PATH = dbPath;
  const { seedCatalogFixtureIntoDb } = await import("../src/infra/catalog-import/fixture");
  const seeded = seedCatalogFixtureIntoDb();
  const { closeDatabase } = await import("../src/infra/db/client");
  closeDatabase();
  console.log(`e2e database reset: ${seeded.insertedEntries} entries, ${seeded.priceEvidenceCount} verified prices.`);
}

void main();
