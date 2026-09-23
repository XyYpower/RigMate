import { randomUUID } from "node:crypto";
import type { BuildItem, BuildItemCategory, Finding } from "@/domain/build/types";
import { buildItemInputSchema } from "@/domain/build/types";
import { runBuildChecks } from "@/domain/rules/engine";
import type { CatalogEntry } from "@/domain/catalog/seed";
import {
  designProposalSchema,
  type CompatibilitySummary,
  type DesignProposal,
  type ProposalItem,
  type StructuredIntent,
} from "@/contracts/design";
import { designTitle } from "./intent";

const CATEGORY_ORDER: BuildItemCategory[] = [
  "cpu",
  "motherboard",
  "gpu",
  "ram",
  "storage",
  "psu",
  "cooler",
  "case",
];

const PREFERRED_IDS: Record<BuildItemCategory, string[]> = {
  cpu: ["cpu-9800x3d", "cpu-7800x3d", "cpu-i7-14700k"],
  motherboard: ["mb-asus-tuf-b650-plus", "mb-msi-b650m-mortar", "mb-gigabyte-b760m-elite"],
  gpu: ["gpu-rtx4090", "gpu-rtx4070s", "gpu-rx7800xt"],
  ram: ["ram-gskill-32-ddr5", "ram-kf-32-ddr5"],
  storage: ["ssd-990pro-1t", "ssd-sn770-1t", "ssd-rc20-1t"],
  psu: ["psu-tuf-850-atx3", "psu-gx-750"],
  cooler: ["cooler-pa120se", "cooler-frozen-prism-240"],
  case: ["case-gt502", "case-pingtouge-m2"],
};

const ITEM_PRICE_ESTIMATES: Record<string, [number, number]> = {
  "cpu-9600x": [219900, 269900],
  "cpu-9800x3d": [349900, 399900],
  "gpu-rtx4060": [219900, 279900],
  "gpu-rtx4070s": [449900, 599900],
  "gpu-rtx4090": [1299900, 1699900],
  "mb-asus-tuf-b650-plus": [139900, 179900],
  "ram-gskill-32-ddr5": [69900, 109900],
  "ssd-sn770-1t": [49900, 79900],
  "psu-sx-650": [39900, 59900],
  "psu-tuf-850-atx3": [99900, 149900],
  "cooler-pa120se": [19900, 29900],
  "case-gt502": [79900, 129900],
};

const PRICE_ESTIMATES: Record<BuildItemCategory, [number, number]> = {
  cpu: [299900, 349900],
  motherboard: [119900, 169900],
  gpu: [899900, 1199900],
  ram: [69900, 129900],
  storage: [49900, 89900],
  psu: [69900, 119900],
  cooler: [19900, 49900],
  case: [69900, 139900],
};

const RATIONALE: Record<BuildItemCategory, string> = {
  cpu: "兼顾剪辑多线程和游戏响应，优先选择高性能桌面处理器。",
  motherboard: "选择与处理器平台一致、扩展性足够的主板。",
  gpu: "游戏和视频剪辑共同决定显卡预算；显存与编码能力优先。",
  ram: "以双通道 DDR5 和 32GB 起步，给剪辑时间线和大型游戏留余量。",
  storage: "先提供一块高速 NVMe，后续可以按素材量扩展容量。",
  psu: "按显卡峰值和整机余量选择，避免只按平均功耗压缩电源。",
  cooler: "在平台兼容的前提下控制噪音与持续负载温度。",
  case: "优先侧透和内部空间，保证高端显卡与散热器有调整余地。",
};

function chooseEntry(
  entries: CatalogEntry[],
  category: BuildItemCategory,
  intent: StructuredIntent,
): CatalogEntry | undefined {
  const budget = intent.budgetCents ?? 2_000_000;
  const cpuId = budget < 1_400_000 ? "cpu-9600x" : "cpu-9800x3d";
  const gpuId = budget < 1_400_000 ? "gpu-rtx4060" : budget < 2_300_000 ? "gpu-rtx4070s" : "gpu-rtx4090";
  const selectedIds: Partial<Record<BuildItemCategory, string>> = {
    cpu: cpuId,
    motherboard: "mb-asus-tuf-b650-plus",
    gpu: gpuId,
    ram: "ram-gskill-32-ddr5",
    storage: "ssd-sn770-1t",
    psu: budget < 1_400_000 ? "psu-sx-650" : "psu-tuf-850-atx3",
    cooler: "cooler-pa120se",
    case: "case-gt502",
  };
  const categoryEntries = entries.filter((entry) => entry.category === category);
  const preferredId = selectedIds[category];
  const preferred = preferredId ? categoryEntries.find((entry) => entry.id === preferredId) : undefined;
  if (preferred) return preferred;
  for (const id of PREFERRED_IDS[category]) {
    const fallback = categoryEntries.find((entry) => entry.id === id);
    if (fallback) return fallback;
  }
  return categoryEntries[0];
}

function buildTransientItems(entries: CatalogEntry[], intent: StructuredIntent): BuildItem[] {
  return CATEGORY_ORDER.flatMap((category) => {
    const entry = chooseEntry(entries, category, intent);
    if (!entry) return [];
    const input = buildItemInputSchema.parse({
      category,
      label: entry.name,
      spec: entry.spec,
      source: `catalog:${entry.id}`,
    });
    return [{ ...input, id: randomUUID(), buildId: "proposal", createdAt: new Date().toISOString() }];
  });
}

function summarizeCompatibility(findings: Finding[]): CompatibilitySummary {
  const counts = { blockCount: 0, warnCount: 0, unknownCount: 0, passCount: 0 };
  for (const finding of findings) {
    if (finding.status === "block") counts.blockCount += 1;
    if (finding.status === "warn") counts.warnCount += 1;
    if (finding.status === "unknown") counts.unknownCount += 1;
    if (finding.status === "pass") counts.passCount += 1;
  }
  if (counts.blockCount > 0) {
    return {
      status: "conflict",
      message: `自动校验发现 ${counts.blockCount} 项需要先处理的兼容冲突。`,
      ...counts,
    };
  }
  if (counts.unknownCount > 0) {
    return {
      status: "unknown",
      message: `方案可以继续，但有 ${counts.unknownCount} 项资料不足，需要确认后再购买。`,
      ...counts,
    };
  }
  if (counts.warnCount > 0) {
    return {
      status: "attention",
      message: `方案基本可行，有 ${counts.warnCount} 项取舍值得确认。`,
      ...counts,
    };
  }
  return { status: "ok", message: "主要硬件组合通过自动校验。", ...counts };
}

function proposalItem(entry: CatalogEntry, intent: StructuredIntent): ProposalItem {
  const [low, high] = ITEM_PRICE_ESTIMATES[entry.id] ?? PRICE_ESTIMATES[entry.category];
  const needsAppearanceConfirmation = intent.appearance.includes("白色") && ["gpu", "case"].includes(entry.category);
  return {
    category: entry.category,
    label: entry.name,
    catalogId: entry.id,
    spec: entry.spec,
    sourceLevel: "verified_catalog",
    priceEstimateLowCents: low,
    priceEstimateHighCents: high,
    priceBasis: "experience_estimate",
    rationale: RATIONALE[entry.category],
    confirmationRequired: needsAppearanceConfirmation,
    ...(needsAppearanceConfirmation
      ? { confirmationReason: "目录当前没有完整的外观颜色字段，建议确认白色版本或在高级 DIY 中替换。" }
      : {}),
  };
}

export function generateDesignProposal(input: {
  requestId: string;
  intent: StructuredIntent;
  entries: CatalogEntry[];
  version?: number;
}): { proposal: DesignProposal; findings: Finding[] } {
  const transientItems = buildTransientItems(input.entries, input.intent);
  const findings = runBuildChecks(transientItems);
  const items = transientItems.map((item) => {
    const entry = input.entries.find((candidate) => candidate.id === item.source?.slice("catalog:".length));
    return entry ? proposalItem(entry, input.intent) : null;
  }).filter((item): item is ProposalItem => item !== null);
  const ranges = items.reduce(
    (total, item) => ({
      low: total.low + (item.priceEstimateLowCents ?? 0),
      high: total.high + (item.priceEstimateHighCents ?? 0),
    }),
    { low: 0, high: 0 },
  );
  const compatibility = summarizeCompatibility(findings);
  const confirmationItems = items.filter((item) => item.confirmationRequired);
  const budget = input.intent.budgetCents;
  const budgetFit =
    budget === null
      ? null
      : ranges.high <= budget
        ? "估算区间在预算内，剩余空间可优先升级显卡或存储。"
        : ranges.low > budget
          ? "估算下限已超出预算，建议进入 DIY 下调显卡或存储档位。"
          : "估算区间横跨预算线，最终价格以购买前核实为准。";
  const unknowns = [
    "价格区间是基于当前可用资料和经验估算，不等同于实时成交价。",
    ...(input.intent.appearance.includes("白色") ? ["当前目录没有完整颜色字段，白色外观需要在购买前确认具体 SKU。"] : []),
    ...(findings.some((finding) => finding.status === "unknown") ? ["有些尺寸、接口或平台支持资料尚未核实。"] : []),
  ];
  const title = designTitle(input.intent);
  const now = new Date().toISOString();
  const proposal = designProposalSchema.parse({
    id: randomUUID(),
    requestId: input.requestId,
    version: input.version ?? 1,
    status: compatibility.status === "conflict" || confirmationItems.length > 0 ? "needs_confirmation" : "ready",
    title,
    summary: `根据“${input.intent.useCases.join("、") || "综合使用"}”和${input.intent.appearance.join("、") || "实用优先"}目标，先给出一套可编辑的均衡方案。`,
    budgetCents: input.intent.budgetCents,
    estimatedLowCents: ranges.low,
    estimatedHighCents: ranges.high,
    items,
    fitNotes: [
      ...(input.intent.useCases.includes("视频剪辑") ? ["剪辑优先：保留较高的处理器、显卡和内存余量。"] : []),
      ...(input.intent.useCases.includes("游戏") ? ["游戏场景：显卡是主要预算与体验支点。"] : []),
      ...(input.intent.appearance.length > 0 ? [`外观方向：${input.intent.appearance.join("、")}。`] : []),
      ...(budgetFit ? [budgetFit] : []),
    ],
    tradeoffs: [
      "方案先保证平台兼容和主要用途，再在外观、噪音与价格之间平衡。",
      "如需严格控制预算，可以优先调整显卡或存储，而不是牺牲平台基础。",
    ],
    unknowns,
    compatibility,
    createdAt: now,
    updatedAt: now,
  });
  return { proposal, findings };
}
