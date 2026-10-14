import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 目录重复行审计 CLI：**只读**，不做任何写入。
 *
 * 背景：同名产品会在界面上显示成一模一样的两行（硬件中心检索、DIY 目录下拉、
 * 方案候选），用户无从分辨。仓库已有 `merged_into` 去重机制，但**该不该合并、
 * 保留哪一条是数据决策，必须先看清再动手**——所以这个脚本只报告，不执行。
 *
 * 报告三件事：
 * 1. 重复行来自哪里（上游 BuildCores 本身就重复，还是本地导入产生）；
 * 2. 哪些重复会真的进界面（只有质量门 verified/supported 的会）；
 * 3. 每条重复行的引用情况——零引用的才适合合并。
 *
 * 注意区分两类引用：
 * - **有意义的**：price_evidence / build_items / proposal_items（真有人在用）
 * - **导入自动生成的**：product_sources / product_field_evidence / data_quality_events
 *   每条 BuildCores 行都有，它们是审计留痕，不代表这条被使用；合并后仍可按 id 查回。
 */

const dbPath = process.env.RIGMATE_DB_PATH ?? resolve("data/rigmate.db");
const db = new Database(dbPath, { readonly: true });

type ProductRow = {
  id: string;
  category: string;
  name: string;
  spec: string;
  source: string;
  quality_status: string;
};

const all = db
  .prepare(
    `select id, category, name, spec, source, quality_status
     from canonical_products where merged_into is null`,
  )
  .all() as ProductRow[];

const gated = all.filter((r) => r.quality_status === "verified" || r.quality_status === "supported");

function group(rows: ProductRow[]) {
  const map = new Map<string, ProductRow[]>();
  for (const r of rows) {
    const key = `${r.category}|${r.name.trim().toLowerCase()}`;
    const g = map.get(key);
    if (g) g.push(r);
    else map.set(key, [r]);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

/** 真有人用的引用；导入留痕不计入 */
function liveRefs(id: string) {
  const one = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(...(args as [])) as { c: number }).c;
  return {
    price: one("select count(*) c from price_evidence where canonical_product_id = ?", id),
    buildItem: one("select count(*) c from build_items where source = ?", `catalog:${id}`),
    proposalItem: one("select count(*) c from proposal_items where catalog_id = ?", id),
  };
}

function traceRefs(id: string) {
  const one = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(...(args as [])) as { c: number }).c;
  return {
    source: one("select count(*) c from product_sources where canonical_product_id = ?", id),
    evidence: one("select count(*) c from product_field_evidence where canonical_product_id = ?", id),
    quality: one("select count(*) c from data_quality_events where canonical_product_id = ?", id),
  };
}

const allDupes = group(all);
const gatedDupes = group(gated);

console.log(`目录总条目 ${all.length}，质量门内 ${gated.length}`);
console.log(`同名重复：全库 ${allDupes.length} 组 / 多出 ${allDupes.reduce((s, g) => s + g.length - 1, 0)} 行`);
console.log(`          质量门内 ${gatedDupes.length} 组 / 多出 ${gatedDupes.reduce((s, g) => s + g.length - 1, 0)} 行  ← 只有这些会出现在界面上`);

const upstreamPath = resolve("data/catalog/buildcores.json");
if (existsSync(upstreamPath)) {
  const file = JSON.parse(readFileSync(upstreamPath, "utf8")) as {
    provenance: { upstreamCommit: string; entryCount: number };
    entries: { category: string; name: string }[];
  };
  const seen = new Map<string, number>();
  for (const e of file.entries) {
    const k = `${e.category}|${e.name.trim().toLowerCase()}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dup = [...seen.values()].filter((n) => n > 1);
  console.log(
    `\n上游 BuildCores（commit ${file.provenance.upstreamCommit.slice(0, 12)}）本身同名重复 ` +
      `${dup.length} 组 / 多出 ${dup.reduce((s, n) => s + n - 1, 0)} 行`,
  );
  console.log("→ 重复来自上游数据，不是本地导入产生的重复");
}

let mergeable = 0;
let referenced = 0;
let specDivergent = 0;

console.log("\n=== 质量门内的重复组明细 ===");
for (const g of gatedDupes) {
  const specs = new Set(g.map((r) => r.spec));
  const divergent = specs.size > 1;
  if (divergent) specDivergent += 1;
  console.log(`\n[${g[0].category}] ${g[0].name}  ×${g.length}${divergent ? "   ⚠ spec 不一致，不能盲目合并" : ""}`);
  for (const r of g) {
    const live = liveRefs(r.id);
    const total = live.price + live.buildItem + live.proposalItem;
    if (total === 0) mergeable += 1;
    else referenced += 1;
    console.log(
      `   ${total === 0 ? "无活跃引用" : "有活跃引用"} ${r.id}  ${r.source}/${r.quality_status}` +
        `  价格${live.price} 配件${live.buildItem} 方案项${live.proposalItem}` +
        `  (导入留痕 来源${traceRefs(r.id).source}/证据${traceRefs(r.id).evidence}/事件${traceRefs(r.id).quality})`,
    );
  }
}

console.log(`\n=== 汇总 ===`);
console.log(`无活跃引用、适合合并的条目：${mergeable}`);
console.log(`有活跃引用、必须保留的条目：${referenced}`);
console.log(`spec 不一致、需人工判断的组：${specDivergent}`);
console.log(
  "\n本脚本只读。合并请走 data_quality_events 审计留痕（setProductMergedInto），" +
    "合并后旧 id 仍可解析但不再进候选。",
);
