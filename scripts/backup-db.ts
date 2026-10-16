import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { ensureDatabase, closeDatabase } from "@/infra/db/client";

/**
 * 数据库备份（内部 Alpha，launch-readiness §10.3 运维）：
 * WAL checkpoint（wal_checkpoint(TRUNCATE) 把 -wal/-shm 内容并回主文件并截断）→
 * 时间戳文件拷贝到 data/backups/。演练验证用 restore-verify 脚本。
 */

const dbPath = process.env.RIGMATE_DB_PATH
  ? resolve(process.env.RIGMATE_DB_PATH)
  : resolve("data/rigmate.db");

if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`);
  process.exit(1);
}

const db = ensureDatabase();
// checkpoint 后主文件即为完整快照，直接拷贝不会丢 WAL 尾部数据
db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
closeDatabase();

const backupDir = resolve("data/backups");
mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupFile = join(backupDir, `rigmate-${timestamp}.db`);
copyFileSync(dbPath, backupFile);

const sizeMb = (statSync(backupFile).size / 1024 / 1024).toFixed(1);
console.log(`备份完成：${backupFile}（${sizeMb} MB）`);
