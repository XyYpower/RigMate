import type { PublishStatus } from "@/domain/catalog/quality";
import type { CatalogEntry } from "@/domain/catalog/seed";
import type { PriceEvidenceInput } from "@/domain/price/evidence";
import type { VerifiedPriceFact } from "@/domain/catalog/ranking";
import { upsertCatalogEntries } from "@/infra/db/repositories/catalog-repository";
import { addPriceEvidence, reviewPriceEvidence } from "@/infra/db/repositories/price-evidence-repository";
import { recordCatalogImportRun } from "@/infra/db/repositories/catalog-import-repository";
import { ensureDatabase } from "@/infra/db/client";

/**
 * 目录/价格 fixture 池（内核恢复计划 Task E）。
 *
 * 用途：单测基线、E2E 种子库（reset-e2e-db）、fresh-clone 门禁验证（gate:data:fixture）。
 * **不进生产导入路径**——生产候选来自 canonical_products 证据链与审核流程。
 *
 * 诚实边界：fixture 产品统一 qualityStatus="supported"（有参考资料、未经人工核验），
 * 不伪造 verified——G2 门禁要求 verified 必须有盖章证据链，fixture 不越线。
 * 价格证据经 repository 正常插入后由 reviewPriceEvidence 审为 verified，
 * 使方案价格路径（Task C：只认已审核证据）在测试里端到端可用。
 */

const TIER_HIGH_PRICES: Record<string, number> = {
  "cpu-9800x3d": 359_900,
  "cpu-7800x3d": 289_900,
  "mb-asus-tuf-b650-plus": 159_900,
  "gpu-rtx4070s": 499_900,
  "gpu-rtx4060": 239_900,
  "ram-gskill-32-ddr5": 89_900,
  "ram-kf-32-ddr5": 79_900,
  "ssd-sn770-1t": 59_900,
  "psu-tuf-850-atx3": 109_900,
  "psu-gx-750": 89_900,
  "psu-sx-650": 49_900,
  "cooler-pa120se": 24_900,
  "case-gt502": 99_900,
};

/** fixture 目录条目：规格沿用种子目录（规则引擎兼容），一律 supported 质量 */
export function fixtureCatalogEntries(): Array<CatalogEntry & { qualityStatus: PublishStatus }> {
  const raw: CatalogEntry[] = [
    { id: "cpu-9800x3d", category: "cpu", name: "AMD Ryzen 7 9800X3D", aliases: ["9800x3d", "x3d"], spec: { socket: "AM5", tdpWatts: 120 } },
    { id: "cpu-7800x3d", category: "cpu", name: "AMD Ryzen 7 7800X3D", aliases: ["7800x3d"], spec: { socket: "AM5", tdpWatts: 120 } },
    { id: "cpu-9600x", category: "cpu", name: "AMD Ryzen 5 9600X", aliases: ["9600x"], spec: { socket: "AM5", tdpWatts: 65 } },
    { id: "mb-asus-tuf-b650-plus", category: "motherboard", name: "华硕 TUF GAMING B650-PLUS WIFI", aliases: ["b650-plus", "tuf b650"], spec: { socket: "AM5", ramType: "DDR5", formFactor: "ATX", ramSlots: 4, m2Slots: 3, sataPorts: 4, pcieX16Slots: 1 } },
    { id: "mb-msi-b650m-mortar", category: "motherboard", name: "微星 MAG B650M MORTAR WIFI", aliases: ["b650m mortar", "迫击炮"], spec: { socket: "AM5", ramType: "DDR5", formFactor: "mATX", ramSlots: 4, m2Slots: 2, sataPorts: 4, pcieX16Slots: 1 } },
    { id: "gpu-rtx4070s", category: "gpu", name: "NVIDIA RTX 4070 SUPER（参考规格）", aliases: ["4070s", "4070 super"], spec: { tdpWatts: 220, twelveVhpwr: 1, pcie8pin: 0 } },
    { id: "gpu-rtx4060", category: "gpu", name: "NVIDIA RTX 4060（参考规格）", aliases: ["4060"], spec: { tdpWatts: 115, pcie8pin: 1, twelveVhpwr: 0 } },
    { id: "ram-gskill-32-ddr5", category: "ram", name: "芝奇 幻锋戟 32GB(2×16GB) DDR5-6000", aliases: ["幻锋戟", "芝奇"], spec: { ddrType: "DDR5", sticks: 2 } },
    { id: "ram-kf-32-ddr5", category: "ram", name: "金士顿 FURY 野兽 32GB(2×16GB) DDR5-5600", aliases: ["fury", "野兽32g"], spec: { ddrType: "DDR5", sticks: 2 } },
    { id: "ssd-sn770-1t", category: "storage", name: "西部数据 SN770 1TB (M.2 NVMe)", aliases: ["sn770"], spec: { interface: "m2_nvme" } },
    { id: "psu-tuf-850-atx3", category: "psu", name: "华硕 TUF Gaming 850W Gold ATX 3.0", aliases: ["tuf 850", "tuf850"], spec: { ratedWatts: 850, pcie8pin: 2, twelveVhpwr: 1 } },
    { id: "psu-gx-750", category: "psu", name: "海韵 FOCUS GX-750（80+ 金牌）", aliases: ["gx750", "海韵750"], spec: { ratedWatts: 750, pcie8pin: 4, twelveVhpwr: 0 } },
    { id: "psu-sx-650", category: "psu", name: "振华 鑫铜 650W（80+ 铜牌）", aliases: ["鑫铜", "650w"], spec: { ratedWatts: 650, pcie8pin: 2, twelveVhpwr: 0 } },
    { id: "cooler-pa120se", category: "cooler", name: "利民 PA120 SE 双塔风冷", aliases: ["pa120", "利民风冷"], spec: { supportedSockets: ["AM4", "AM5", "LGA1700", "LGA1851"], heightMm: 155 } },
    { id: "case-gt502", category: "case", name: "华硕 TUF Gaming GT502 弹药库", aliases: ["gt502", "弹药库"], spec: { supportedFormFactors: ["ATX", "mATX", "ITX", "E-ATX"], maxGpuLengthMm: 400, maxCoolerHeightMm: 180 } },
    // 一条 partial 对照：质量门必须把它排除（不得进入任何方案候选）
    { id: "cpu-partial-demo", category: "cpu", name: "演示用 partial 处理器", aliases: ["partial demo"], spec: { socket: "AM5", tdpWatts: 88 } },
  ];
  return raw.map((entry) =>
    entry.id === "cpu-partial-demo"
      ? { ...entry, qualityStatus: "partial" as const }
      : { ...entry, qualityStatus: "supported" as const },
  );
}

/** fixture 价格证据输入（未审核态；入库后用 reviewPriceEvidence 审为 verified） */
export function fixturePriceEvidenceInputs(): PriceEvidenceInput[] {
  return Object.entries(TIER_HIGH_PRICES).map(([canonicalProductId, priceCents]) => {
    const entry = fixtureCatalogEntries().find((candidate) => candidate.id === canonicalProductId)!;
    return {
      category: entry.category,
      productName: entry.name,
      priceCents,
      priceBasis: "到手价",
      sourceType: "manual_entry" as const,
      platform: "京东",
      shop: "京东自营",
      condition: "全新",
      canonicalProductId,
      region: "中国大陆",
    };
  });
}

/** 已审核价格快查表（纯函数单测用：不经过数据库） */
export function fixtureVerifiedPriceMap(): Map<string, VerifiedPriceFact> {
  const now = new Date().toISOString();
  return new Map(
    Object.entries(TIER_HIGH_PRICES).map(([id, priceCents]) => [
      id,
      { canonicalProductId: id, priceCents, evidenceIds: [`fixture-pe-${id}`], capturedAt: now },
    ]),
  );
}

/**
 * 把 fixture 池种进当前数据库（RIGMATE_DB_PATH；ensureDatabase 负责建 schema）。
 * 供 E2E 重置脚本、gate:data:fixture 与服务层单测共用。
 * 写入走正式仓储：目录 upsert（supported）→ 价格插入 → 价格人工审为 verified（走审核接口，不直改状态）。
 */
export function seedCatalogFixtureIntoDb(): {
  insertedEntries: number;
  priceEvidenceCount: number;
} {
  ensureDatabase();
  const { inserted } = upsertCatalogEntries(
    fixtureCatalogEntries().map((entry) => ({ ...entry, source: "seed" as const })),
  );
  const records = fixturePriceEvidenceInputs().map((input) => addPriceEvidence(input));
  for (const record of records) {
    reviewPriceEvidence(record.id, "verified");
  }
  recordCatalogImportRun({
    upstreamCommit: "fixture",
    upstreamUrl: null,
    license: "fixture-local",
    sourcePath: "src/infra/catalog-import/fixture.ts",
    filesRead: 1,
    importedCount: inserted,
    skippedCount: 0,
    errorCount: 0,
    errors: [],
  });
  return { insertedEntries: inserted, priceEvidenceCount: records.length };
}
