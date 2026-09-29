import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { auditCatalog, type AuditableCatalogEntry } from "../src/domain/catalog/audit";

const dbPath = process.env.RIGMATE_DB_PATH ?? resolve("data/rigmate.db");
const outputPath = process.env.RIGMATE_CATALOG_AUDIT_PATH;
const db = new Database(dbPath, { readonly: true });
const rows = db.prepare("select id, category, name, aliases, spec, source from canonical_products order by category, name, id").all() as Array<{ id: string; category: AuditableCatalogEntry["category"]; name: string; aliases: string; spec: string; source: AuditableCatalogEntry["source"] }>;
const entries: AuditableCatalogEntry[] = rows.map((row) => ({ id: row.id, category: row.category, name: row.name, aliases: JSON.parse(row.aliases) as string[], spec: JSON.parse(row.spec) as Record<string, unknown>, source: row.source }));
const report = auditCatalog(entries);
const payload = { generatedAt: new Date().toISOString(), dbPath, report };

if (outputPath) {
  const resolved = resolve(outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, JSON.stringify(payload, null, 2), "utf8");
}

console.log("目录总数：" + report.total);
for (const [category, value] of Object.entries(report.byCategory)) {
  const rate = value.total === 0 ? 0 : (value.complete / value.total) * 100;
  const missing = Object.entries(value.missing).map(([field, count]) => field + "=" + count).join("，") || "无";
  console.log(category + ": " + value.complete + "/" + value.total + " 完整（" + rate.toFixed(1) + "%）");
  console.log("  缺失：" + missing);
}
console.log("来源：", report.bySource);
console.log("重复规范名称：" + report.duplicateNames.length);
if (outputPath) console.log("报告：" + resolve(outputPath));
