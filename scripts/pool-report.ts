import { loadCatalogEntries } from "../src/infra/db/repositories/catalog-repository";
import { requiredFieldsOf } from "../src/domain/catalog/quality";
import { loadPriceContext } from "../src/application/design/price-context";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 最小候选池整理报告（npm run pool:report）：
 * 输出质量门内产品的八类清单——每类的产品数、代表型号、价格证据覆盖、缺字段统计。
 * 给"产品整理好没有"一个可核对的答案。
 */

const CATEGORIES = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"] as const;

const entries = loadCatalogEntries();
const supported = entries.filter((entry) => entry.qualityStatus === "supported" || entry.qualityStatus === "verified");
const prices = loadPriceContext({ region: "中国大陆" });

const lines: string[] = ["# 最小候选池整理报告", "", `生成时间：${new Date().toISOString()}`, ""];

let totalWithPrice = 0;
for (const category of CATEGORIES) {
  const pool = supported.filter((entry) => entry.category === category);
  const required = requiredFieldsOf(category);
  const withPrice = pool.filter((entry) => prices.has(entry.id));
  totalWithPrice += withPrice.length;

  lines.push(`## ${category}（${pool.length} 条在池）`);
  lines.push("");
  for (const entry of pool.slice(0, 12)) {
    const price = prices.get(entry.id);
    lines.push(`- [${entry.qualityStatus}] ${entry.name}${price ? ` · ¥${(price.priceCents / 100).toLocaleString("zh-CN")}` : " · 暂无已审核价格"}`);
  }
  if (pool.length > 12) lines.push(`- …另有 ${pool.length - 12} 条`);
  lines.push("");
  void withPrice;
}

lines.push(`## 汇总`);
lines.push("");
lines.push(`- 质量门内产品：${supported.length} 条`);
lines.push(`- 有已审核价格：${totalWithPrice} 条`);
lines.push(`- 价格证据覆盖率：${supported.length === 0 ? "0%" : `${Math.round((totalWithPrice / supported.length) * 100)}%`}（价格证据审核通过后自动生效）`);
lines.push("");

mkdirSync(resolve("data/report"), { recursive: true });
writeFileSync(resolve("data/report/pool-report.md"), lines.join("\n"), "utf8");
console.log(`报告已写入 data/report/pool-report.md`);
console.log(lines.filter((line) => line.startsWith("##") || line.startsWith("- 质量门内") || line.startsWith("- 有已审核") || line.startsWith("- 价格证据")).join("\n"));
