import { copyFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { LATEST_SCHEMA_VERSION, readSchemaVersion } from "@/infra/db/migrate";
import type { RigmateDatabase } from "@/infra/db/client";

/**
 * 恢复演练（内部 Alpha）：把指定备份还原到临时路径 → 打开 → 断言
 * schema 版本与当前代码一致 + 关键表行数与当前库一致。
 * 用法：npm run db:restore-verify -- data/backups/rigmate-xxxx.db
 */

const backupFile = resolve(process.argv[2] ?? "");
if (!backupFile || !existsSync(backupFile)) {
  console.error("用法：npm run db:restore-verify -- <备份文件路径>（文件必须存在）");
  process.exit(1);
}

const currentDbPath = process.env.RIGMATE_DB_PATH
  ? resolve(process.env.RIGMATE_DB_PATH)
  : resolve("data/rigmate.db");
const currentSqlite = new Database(currentDbPath, { readonly: true });
const currentDb = drizzle(currentSqlite) as unknown as RigmateDatabase;

function tableCount(db: RigmateDatabase, table: string): number {
  const rows = db.all<{ c: number }>(sql.raw(`SELECT count(*) AS c FROM ${table}`));
  return rows[0]?.c ?? 0;
}

const KEY_TABLES = ["design_requests", "design_proposals", "agent_event_log", "canonical_products", "builds"];

// 当前库基线
const currentVersion = readSchemaVersion(currentDb);
const currentCounts = Object.fromEntries(KEY_TABLES.map((table) => [table, tableCount(currentDb, table)]));
currentSqlite.close();

// 还原到临时路径并验证
const tempRestore = resolve("data/backups/.restore-verify.tmp");
copyFileSync(backupFile, tempRestore);
try {
  const sqlite = new Database(tempRestore);
  const restoredDb = drizzle(sqlite) as unknown as RigmateDatabase;
  const restoredVersion = readSchemaVersion(restoredDb);
  const restoredCounts = Object.fromEntries(KEY_TABLES.map((table) => [table, tableCount(restoredDb, table)]));
  sqlite.close();

  let pass = true;
  if (restoredVersion !== LATEST_SCHEMA_VERSION) {
    console.error(`✗ schema 版本不一致：备份 v${restoredVersion}，代码 v${LATEST_SCHEMA_VERSION}`);
    pass = false;
  } else {
    console.log(`✓ schema 版本 v${restoredVersion}`);
  }
  for (const table of KEY_TABLES) {
    if (restoredCounts[table] !== currentCounts[table]) {
      console.error(`✗ ${table} 行数不一致：备份 ${restoredCounts[table]}，当前 ${currentCounts[table]}`);
      pass = false;
    } else {
      console.log(`✓ ${table}：${restoredCounts[table]} 行`);
    }
  }
  if (!pass) process.exit(1);
  console.log(`\n恢复演练通过：${backupFile}`);
} finally {
  rmSync(tempRestore, { force: true });
}
