import { syncAsusMotherboards } from "../src/infra/catalog-import/cn/sync";
import { importManufacturerCnProducts } from "../src/infra/catalog-import/cn/import";
import { toDiscoveredProduct } from "../src/infra/catalog-import/cn/asus";

const args = process.argv.slice(2);
const live = args.includes("--live");
const write = args.includes("--write");

function argValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const source = argValue("--source") ?? "asus-rog";
const indexUrl =
  argValue("--index-url") ??
  "https://rog.asus.com.cn/motherboards-group/allmodels/";
const limit = Number(argValue("--limit") ?? "20");
const timeoutMs = Number(argValue("--timeout-ms") ?? "20000");

async function main(): Promise<void> {
  if (source !== "asus-rog") {
    console.error(`不支持的数据源：${source}。当前支持 asus-rog。`);
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    console.error("--limit 必须是 1 到 200 之间的整数。");
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    console.error("--timeout-ms 必须是 100 到 120000 之间的整数。");
    process.exitCode = 1;
    return;
  }
  if (write && !live) {
    console.error("--write 必须与 --live 一起使用；默认只读，不写入目录。");
    process.exitCode = 1;
    return;
  }

  if (!live) {
    console.log(`dry-run：不会联网或写入数据库（source=${source}，limit=${limit}）。`);
    console.log("执行真实同步请加 --live；需要写入 RigMate 再加 --write。 ");
    return;
  }

  const result = await syncAsusMotherboards({ indexUrl, limit, timeoutMs });
  console.log(`来源：华硕中国/ROG · 索引发现 ${result.discovered} 条 · 本次读取 ${result.products.length} 条`);
  if (result.rejected.length > 0) {
    console.log(`失败 ${result.rejected.length} 条：`);
    for (const item of result.rejected) console.log(`  - ${item.url}：${item.reason}`);
  }
  for (const product of result.products) {
    console.log(
      `  ${product.name} · MPN ${product.mpn} · ${Object.keys(product.spec).length} 个决策字段` +
        (product.priceCny ? ` · ¥${product.priceCny}` : ""),
    );
  }

  if (write && result.products.length > 0) {
    const imported = importManufacturerCnProducts(result.products.map(toDiscoveredProduct));
    console.log(
      `已写入目录：新增 ${imported.inserted}，重复跳过 ${imported.skipped}，来源 ${imported.sources}，字段证据 ${imported.evidence}。`,
    );
  } else {
    console.log("只读结果未写入数据库；确认样本后使用 --live --write。 ");
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
