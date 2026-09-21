// E2E 专用：每次测试运行前重置隔离数据库，保证测试确定性（不触碰开发库 rigmate.db）
import fs from "node:fs";

for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`./data/e2e.db${suffix}`, { force: true });
}
console.log("e2e database reset.");
