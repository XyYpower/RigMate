import { loadSourcedCatalog } from "../src/infra/catalog-import/load";
import { priceEvidenceStats } from "../src/infra/db/repositories/price-evidence-repository";
import { closeDatabase } from "../src/infra/db/client";
import type { BuildItemCategory } from "../src/domain/build/types";

/**
 * 目录覆盖报表（launch-readiness spec §7.2 首版最低覆盖目标）：
 *   - 八个类别每类 ≥30 条 supported 候选；
 *   - CPU / GPU / 主板 / 电源每类 ≥10 条 verified 候选；
 *   - ≥30 条 verified 价格证据；
 *   - 热门型号中文名 / 别名 / 关键决策字段覆盖。
 * 只读，不写库。作为数据发布门（Phase 1）的日常检查工具。
 */

const CATEGORIES: BuildItemCategory[] = ["cpu", "motherboard", "gpu", "ram", "storage", "psu", "cooler", "case"];

const SUPPORTED_TARGET = 30;
const VERIFIED_TARGET = 10; // 仅 cpu/motherboard/gpu/psu 有 verified 目标
const VERIFIED_CATEGORIES = new Set<BuildItemCategory>(["cpu", "motherboard", "gpu", "psu"]);
const PRICE_VERIFIED_TARGET = 30;

const CATEGORY_LABELS: Record<BuildItemCategory, string> = {
  cpu: "CPU",
  motherboard: "主板",
  gpu: "显卡",
  ram: "内存",
  storage: "固态",
  psu: "电源",
  cooler: "散热器",
  case: "机箱",
};

const { entries, dbBacked } = loadSourcedCatalog();
const gate = entries.filter((entry) => entry.qualityStatus === "verified" || entry.qualityStatus === "supported");

console.log(`数据源：${dbBacked ? "canonical_products（DB）" : "JSON 回退"}；质量门内 ${gate.length} 条 / 全目录 ${entries.length} 条\n`);

const rows: string[] = [];
let allSupportedPass = true;
for (const category of CATEGORIES) {
  const inGate = gate.filter((entry) => entry.category === category);
  const verified = inGate.filter((entry) => entry.qualityStatus === "verified").length;
  const withZh = inGate.filter(
    (entry) => (entry.nameZh && /[\u4e00-\u9fff]/.test(entry.nameZh)) || /[\u4e00-\u9fff]/.test(entry.name),
  ).length;
  const withAliases = inGate.filter((entry) => entry.aliases.length > 0).length;

  const supportedOk = inGate.length >= SUPPORTED_TARGET;
  if (!supportedOk) allSupportedPass = false;
  const verifiedTargetApplies = VERIFIED_CATEGORIES.has(category);
  const verifiedOk = !verifiedTargetApplies || verified >= VERIFIED_TARGET;

  rows.push(
    `${CATEGORY_LABELS[category].padEnd(4)} supported ${String(inGate.length).padStart(4)}${supportedOk ? " ✓" : ` ✗(<${SUPPORTED_TARGET})`}` +
      (verifiedTargetApplies
        ? ` | verified ${String(verified).padStart(3)}${verifiedOk ? " ✓" : ` ✗(<${VERIFIED_TARGET})`}`
        : " | verified  —") +
      ` | 中文名 ${withZh} | 别名 ${withAliases}`,
  );
}
for (const row of rows) console.log(row);

const prices = priceEvidenceStats();
console.log(
  `\n价格证据：verified ${prices.verified}${prices.verified >= PRICE_VERIFIED_TARGET ? " ✓" : ` ✗(<${PRICE_VERIFIED_TARGET})`} / 总数 ${prices.total}（90 天内 ${prices.total - prices.olderThan90Days}）`,
);

console.log(
  `\n结论：supported 覆盖${allSupportedPass ? "达标" : "未达标"}；verified 候选与价格证据需要证据链审核流程推进（目前缺口最大的一项）。`,
);
closeDatabase();
