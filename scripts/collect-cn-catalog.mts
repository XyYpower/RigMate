import { REQUIRED_FIELDS_BY_CATEGORY } from "@/domain/catalog/audit";
import type { BuildItemCategory } from "@/domain/build/types";
import { msiAdapter } from "@/infra/catalog-import/cn/msi";
import type { DiscoveredProduct, VendorAdapter } from "@/infra/catalog-import/cn/contract";

/**
 * 大陆厂商官网采集 CLI。
 *
 * 默认 dry-run：只报告"会写入什么、能过质量门多少"，不落库。
 * 加 --write 才写入，且写入的每条都带来源快照与字段级证据。
 *
 * 用法：
 *   npm run catalog:collect-cn -- --vendor msi --limit 20
 *   npm run catalog:collect-cn -- --vendor msi --category motherboard --limit 40 --write
 */

type Options = {
  vendor: string;
  category?: BuildItemCategory;
  limit: number;
  write: boolean;
  timeoutMs: number;
};

/** spec 是八类字段的并集；按必填字段名索引需要收窄到可索引视图 */
function hasField(spec: object, field: string): boolean {
  return (spec as Record<string, unknown>)[field] !== undefined &&
    (spec as Record<string, unknown>)[field] !== null;
}

function isComplete(spec: object, category: BuildItemCategory): boolean {
  return REQUIRED_FIELDS_BY_CATEGORY[category].every((field) => hasField(spec, field));
}

function parseArgs(argv: string[]): Options {
  const options: Options = { vendor: "msi", limit: 20, write: false, timeoutMs: 30_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = () => argv[++index];
    if (arg === "--vendor") options.vendor = String(next());
    else if (arg === "--category") options.category = String(next()) as BuildItemCategory;
    else if (arg === "--limit") options.limit = Number(next());
    else if (arg === "--write") options.write = true;
    else if (arg === "--timeout-ms") options.timeoutMs = Number(next());
  }
  return options;
}

const ADAPTERS: Record<string, VendorAdapter> = { msi: msiAdapter };

const options = parseArgs(process.argv.slice(2));
const adapter = ADAPTERS[options.vendor];
if (!adapter) {
  console.error(`未知厂商：${options.vendor}（已实现：${Object.keys(ADAPTERS).join(", ")}）`);
  process.exit(1);
}

const categories: BuildItemCategory[] = options.category
  ? [options.category]
  : adapter.categories;

console.log(`厂商：${adapter.vendor}（${adapter.site}）`);
console.log(`覆盖类别：${categories.join("、")}`);
console.log(`模式：${options.write ? "写入" : "dry-run（只报告，不落库）"}\n`);

const products: DiscoveredProduct[] = [];
const skipped: { url: string; reason: string }[] = [];
let fetched = 0;

for (const category of categories) {
  let urls: string[] = [];
  try {
    urls = await adapter.discover(category, { limit: options.limit });
  } catch (error) {
    console.error(`  [${category}] 发现失败：${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  console.log(`[${category}] 发现 ${urls.length} 个产品页`);

  for (const url of urls) {
    const html = await adapter.fetchPage(url, { timeoutMs: options.timeoutMs });
    fetched += 1;
    if (!html) {
      skipped.push({ url, reason: "抓取失败或超时（已重试）" });
      continue;
    }
    const parsed = adapter.parse(url, category, html);
    if (!parsed.product) {
      skipped.push({ url, reason: parsed.skipReason ?? "无法解析" });
      continue;
    }
    products.push(parsed.product);
    // 礼貌抓取：官方站点友好，不连续轰炸
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

const complete = products.filter((product) => isComplete(product.spec, product.category));

console.log(`\n=== 采集结果 ===`);
console.log(`抓取页数：${fetched}`);
console.log(`解析成功：${products.length}`);
console.log(`跳过：${skipped.length}`);
console.log(`必填字段齐全（可进候选池）：${complete.length} / ${products.length}`);

const byCategory = new Map<string, { total: number; complete: number }>();
for (const product of products) {
  const bucket = byCategory.get(product.category) ?? { total: 0, complete: 0 };
  bucket.total += 1;
  if (isComplete(product.spec, product.category)) bucket.complete += 1;
  byCategory.set(product.category, bucket);
}

console.log("\n分类别：");
for (const [category, stat] of byCategory) {
  console.log(`  ${category.padEnd(11)} 齐全 ${stat.complete}/${stat.total}`);
}

const missing = new Map<string, number>();
for (const product of products) {
  for (const field of REQUIRED_FIELDS_BY_CATEGORY[product.category]) {
    if (!hasField(product.spec, field)) {
      missing.set(field, (missing.get(field) ?? 0) + 1);
    }
  }
}
console.log("\n最常缺失的必填字段（适配器要补的解析规则）：");
for (const [field, count] of [...missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))
  console.log(`  ${field.padEnd(22)} ${count}`);

console.log("\n样例（前 8 条，含字段来源，便于人工核对错配）：");
for (const product of products.slice(0, 8)) {
  const ok = isComplete(product.spec, product.category);
  console.log(`  ${ok ? "✓" : "·"} [${product.category}] ${product.name}`);
  console.log(`     spec: ${JSON.stringify(product.spec)}`);
  if (product.priceCny !== undefined) console.log(`     官网标价 ¥${product.priceCny}`);
  // 打印证据来源：字段值是从页面上哪句话解析来的
  for (const item of product.evidence.slice(0, 4)) {
    console.log(`     · ${item.fieldPath} ← 「${item.excerpt.slice(0, 70)}」`);
  }
}

if (skipped.length > 0) {
  console.log("\n跳过样本：");
  for (const item of skipped.slice(0, 5)) console.log(`  ${item.reason}  ${item.url}`);
}

if (options.write) {
  const { importManufacturerCnProducts } = await import("@/infra/catalog-import/cn/import");
  const report = importManufacturerCnProducts(products);
  console.log("\n=== 写入结果 ===");
  console.log(`新增条目：${report.inserted}　已存在跳过：${report.skipped}`);
  console.log(`来源快照：${report.sources}　字段证据：${report.evidence}　价格证据：${report.prices}`);
  console.log("\n注意：自动来源的字段证据一律 unreviewed，产品只到 supported（不进 verified）。");
  console.log("价格按「厂商标价」记录，reviewStatus=unreviewed，需人工审核才进预算排序。");
}
