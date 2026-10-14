import Database from "better-sqlite3";
import { resolve } from "node:path";
import { resolveDisplayNames, type DisplayNameBasis } from "../src/domain/catalog/localization";

/**
 * 中文展示名覆盖率报表 CLI：只读。
 *
 * 为什么需要它：厂商中文名对照表（domain/catalog/localization.ts 的 VENDOR_NAME_ZH）
 * 是手工维护的，而目录会随新数据源导入不断变大。表和目录一旦脱节，
 * 界面就会有一批新产品悄悄退回纯英文名，而且没人会发现。
 *
 * 读的是质量门内（verified/supported）的条目——只有这些会出现在界面上。
 * "未命中"不等于缺陷：TEAMGROUP / NZXT / EVGA / PNY 这些品牌在大陆装机圈
 * 本来就直接说英文，硬翻反而添乱。报表的价值在于**发现真正值得补录的厂商**。
 *
 * 末尾会报「因撞车回退不截断」的条数：这些是"型号只在末尾参数上不同"的变体，
 * 截断会把它们显示成同一个名字，所以系统主动保留了完整参数（见 resolveDisplayNames）。
 */

const dbPath = process.env.RIGMATE_DB_PATH ?? resolve("data/rigmate.db");
const db = new Database(dbPath, { readonly: true });

type ProductRow = { category: string; name: string; name_zh: string | null };

const products = db
  .prepare(
    `select category, name, name_zh from canonical_products
     where merged_into is null and quality_status in ('verified','supported')`,
  )
  .all() as ProductRow[];

const resolved = resolveDisplayNames(products, (row) => row.category);

const BASIS_LABEL: Record<DisplayNameBasis, string> = {
  official_cn: "官网中文名",
  already_zh: "原名已中文",
  vendor_zh: "厂商前缀中文",
  en_only: "无中文名",
};

const counts = { official_cn: 0, already_zh: 0, vendor_zh: 0, en_only: 0 } as Record<DisplayNameBasis, number>;
const byCategory = new Map<string, { total: number; zh: number; trimmed: number }>();
const misses = new Map<string, number>();
let untrimmed = 0;
let tokensBefore = 0;
let tokensAfter = 0;

for (const row of resolved) {
  counts[row.displayNameBasis] += 1;
  const bucket = byCategory.get(row.category) ?? { total: 0, zh: 0, trimmed: 0 };
  bucket.total += 1;
  // 中文与可读性是两件事，分开统计：厂商中文名 vs 尾部参数截断
  if (row.displayNameBasis !== "en_only") bucket.zh += 1;
  if (row.displayName !== row.displayNameOriginal) bucket.trimmed += 1;
  byCategory.set(row.category, bucket);
  if (row.displayNameBasis === "en_only") {
    const head = row.name.trim().split(/\s+/).slice(0, 2).join(" ");
    misses.set(head, (misses.get(head) ?? 0) + 1);
  }
  if (row.displayNameUntrimmed) untrimmed += 1;
  tokensBefore += row.name.trim().split(/\s+/).length;
  tokensAfter += row.displayName.trim().split(/\s+/).length;
}

const localized = counts.official_cn + counts.already_zh + counts.vendor_zh;
const rate = products.length === 0 ? 0 : (localized / products.length) * 100;

console.log(`质量门内条目：${products.length}`);
for (const basis of ["official_cn", "already_zh", "vendor_zh", "en_only"] as DisplayNameBasis[]) {
  const share = products.length === 0 ? 0 : (counts[basis] / products.length) * 100;
  console.log(`  ${BASIS_LABEL[basis].padEnd(6)} ${String(counts[basis]).padStart(6)}  ${share.toFixed(1)}%`);
}
console.log(`  合计中文：${localized}（${rate.toFixed(1)}%）`);

const avg = (total: number) => (products.length === 0 ? 0 : total / products.length);
console.log(
  `展示名长度：平均 ${avg(tokensBefore).toFixed(1)} → ${avg(tokensAfter).toFixed(1)} 词元` +
    `（因同类别撞车保留完整参数：${untrimmed} 条）`,
);

console.log("\n分类别（中文名 / 参数截断 是两件独立的事）：");
for (const [category, stat] of [...byCategory.entries()].sort()) {
  const zh = stat.total === 0 ? 0 : (stat.zh / stat.total) * 100;
  const trim = stat.total === 0 ? 0 : (stat.trimmed / stat.total) * 100;
  console.log(
    `  ${category.padEnd(11)} 中文 ${String(stat.zh).padStart(4)}/${String(stat.total).padEnd(4)} ${zh.toFixed(1).padStart(5)}%` +
      `   已裁参数 ${String(stat.trimmed).padStart(4)} ${trim.toFixed(1).padStart(5)}%`,
  );
}

const topMisses = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log("\n无中文名前缀最多的厂商（仅供人工判断是否值得补录，不自动翻译）：");
for (const [head, count] of topMisses) console.log(`  ${String(count).padStart(4)}  ${head}`);
