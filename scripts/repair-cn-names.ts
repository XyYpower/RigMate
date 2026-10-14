import Database from "better-sqlite3";

/**
 * 一次性修复：把采集时写坏的**产品名**纠正回来。
 *
 * 背景：MSI 的 B460/B550/H510 是"芯片组系列页"，多个型号共用一个页面，
 * 标题里只有系列名；部分页面标题还带 "| Gaming Motherboards｜…｜MSI" 的 SEO 尾巴。
 * 于是当时入库的 203 条里有 42 条名字带 SEO 尾巴、4 组重名。
 *
 * 修复依据：URL slug 是型号级标识（canonical_products.ref_url 记录了官网 URL），
 * 从中还原型号名；slug 不足以补全时，才保留页面名并只剥掉 SEO 尾巴。
 *
 * 只改 name ——它是展示/身份锚，spec、质量状态、证据链一概不动。
 * 默认 dry-run，加 --write 才落库。
 */

import { cleanProductName, preferSpecificName } from "../src/infra/catalog-import/cn/contract";

const dbPath = process.env.RIGMATE_DB_PATH ?? "data/rigmate.db";
const write = process.argv.includes("--write");
const db = new Database(dbPath);

type Row = { id: string; name: string; ref_url: string };
const rows = db
  .prepare(`select id, name, ref_url from canonical_products where id like 'cn-msi-%'`)
  .all() as Row[];

/** 从官网 URL 还原型号 slug。规格页路径是 /Motherboard/<型号>/Specification，
 *  型号在**倒数第二段**——直接取最后一段会拿到 "Specification"。 */
function slugOf(refUrl: string): string | undefined {
  try {
    const segments = new URL(refUrl).pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    const model = last && /^(specification|spec|overview)$/i.test(last)
      ? segments[segments.length - 2]
      : last;
    return model || undefined;
  } catch {
    return undefined;
  }
}

let fixed = 0;
const updates: { id: string; from: string; to: string }[] = [];
for (const row of rows) {
  const slug = slugOf(row.ref_url);
  const cleaned = cleanProductName(row.name);
  const next = preferSpecificName(cleaned, slug);
  if (next && next !== row.name) {
    updates.push({ id: row.id, from: row.name, to: next });
    fixed += 1;
  }
}

console.log(`微星条目 ${rows.length}，需要修名 ${fixed}`);
for (const u of updates.slice(0, 12)) {
  console.log(`  ${JSON.stringify(u.from).slice(0, 60)}\n    → ${u.to}`);
}

// 修完后的重名检查
const nextNames = new Map<string, string[]>();
for (const row of rows) {
  const next = updates.find((u) => u.id === row.id)?.to ?? row.name;
  nextNames.set(next, [...(nextNames.get(next) ?? []), row.id]);
}
const dups = [...nextNames.entries()].filter(([, ids]) => ids.length > 1);
console.log(`\n修完后的重名组：${dups.length}`);
for (const [name, ids] of dups.slice(0, 6)) console.log(`  ${name} ×${ids.length}`);

if (!write) {
  console.log("\n(dry-run，未写库；加 --write 执行)");
} else {
  const update = db.prepare("update canonical_products set name = ? where id = ?");
  const tx = db.transaction(() => {
    for (const u of updates) update.run(u.to, u.id);
  });
  tx();
  console.log(`\n已更新 ${updates.length} 条产品名`);
}
db.close();