import { rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * fixture 种子 CLI（内核恢复计划 Task E）：
 *   npm run db:fixture                     → 种到 RIGMATE_DB_PATH（缺省 data/fixture.db）
 *   RIGMATE_DB_PATH=./data/e2e.db npm run db:fixture → 种到指定库
 * 带 --fresh 时先删除目标库再重建（可复现基线）。
 */

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const dbPath = process.env.RIGMATE_DB_PATH ? resolve(process.env.RIGMATE_DB_PATH) : resolve("data/fixture.db");

if (fresh) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

async function main(): Promise<void> {
  process.env.RIGMATE_DB_PATH = dbPath;
  const { seedCatalogFixtureIntoDb } = await import("../src/infra/catalog-import/fixture");
  const seeded = seedCatalogFixtureIntoDb();
  const { closeDatabase } = await import("../src/infra/db/client");
  closeDatabase();
  console.log(`fixture seeded into ${dbPath}: ${seeded.insertedEntries} entries, ${seeded.priceEvidenceCount} verified prices.`);
}

void main();
