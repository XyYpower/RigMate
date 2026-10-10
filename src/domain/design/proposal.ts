import { randomUUID } from "node:crypto";
import type { BuildItem, BuildItemCategory, Finding } from "@/domain/build/types";
import { buildItemInputSchema } from "@/domain/build/types";
import { runBuildChecks } from "@/domain/rules/engine";
import type { FieldQualityStatus } from "@/domain/catalog/quality";
import type { CandidateSummary } from "@/domain/catalog/ranking";
import {
  designProposalSchema,
  type CompatibilitySummary,
  type DesignProposal,
  type ProposalItem,
  type StructuredIntent,
} from "@/contracts/design";
import { designTitle } from "./intent";
import { existingPartCategories } from "./revision";

/**
 * 方案生成（内核恢复计划 Task A/B/C 重写）：
 * - 候选空间只来自质量门（verified/supported，由 ranking.buildCandidatePool 产出）；
 *   partial/conflicting/stale/rejected 一律不在本文件出现，更不会冒充 verified_catalog；
 * - 价格只认已审核（verified）价格证据：没有证据时上下限为 null、priceBasis=unknown，
 *   源码常量估价（旧 ITEM_PRICE_ESTIMATES / PRICE_ESTIMATES）已删除；
 * - 候选不足返回 insufficient + 缺失类别，不用 partial 凑齐八类。
 */

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

const CATEGORY_LABELS: Record<BuildItemCategory, string> = {
  cpu: "处理器",
  motherboard: "主板",
  gpu: "显卡",
  ram: "内存",
  storage: "存储",
  psu: "电源",
  cooler: "散热器",
  case: "机箱",
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

/** 每个候选随行的质量上下文（service 从字段证据链解析；无证据链候选为空映射） */
export type CandidateQualityContext = {
  fieldQuality: Record<string, FieldQualityStatus>;
  evidenceSourceIds: string[];
};

export type DesignGenerationInput = {
  requestId: string;
  intent: StructuredIntent;
  /** Task B 排序后的候选池；本函数只在其中挑选，绝不回退到质量门之外的目录 */
  candidates: CandidateSummary[];
  /** canonicalId → 字段质量层（用于规则门 gateFieldQuality 与方案项透出） */
  qualityContextByCanonicalId?: Map<string, CandidateQualityContext>;
  version?: number;
  /** Task D 受约束模型选择：只允许指向候选池内已有 ID（校验已在 intent-llm 完成，这里兜底） */
  preferredIds?: Partial<Record<BuildItemCategory, string>>;
  rationaleByCategory?: Partial<Record<BuildItemCategory, string>>;
  /** Runtime 可注入同一确定性只读检查器，默认领域规则路径保持兼容。 */
  compatibilityCheck?: (items: BuildItem[]) => Finding[];
};

export type DesignGenerationResult =
  | {
      status: "ok";
      proposal: DesignProposal;
      findings: Finding[];
      /** 瞬态配件 id → 类别（供编排器把 finding.itemIds 映射回类别，驱动换件迭代） */
      categoryByItemId: Record<string, BuildItemCategory>;
    }
  | { status: "insufficient"; missingCategories: BuildItemCategory[] };

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

function candidateToItem(
  candidate: CandidateSummary,
  intent: StructuredIntent,
  quality: CandidateQualityContext | undefined,
  rationaleOverride?: string,
): ProposalItem {
  const needsAppearanceConfirmation = intent.appearance.includes("白色") && ["gpu", "case"].includes(candidate.category);
  // 价格只认已审核证据：候选摘要的 priceCents 来自 verified 价格证据（Task C）；无证据 = null + unknown
  const priceCents = candidate.priceCents;
  const sourceLevel = candidate.qualityStatus === "verified" ? "verified_catalog" as const : "supported_catalog" as const;
  return {
    category: candidate.category,
    label: candidate.name,
    catalogId: candidate.canonicalId,
    spec: candidate.spec,
    sourceLevel,
    qualityStatus: candidate.qualityStatus,
    fieldQuality: quality?.fieldQuality ?? {},
    evidenceSourceIds: quality?.evidenceSourceIds ?? candidate.sourceIds,
    priceEstimateLowCents: priceCents,
    priceEstimateHighCents: priceCents,
    priceBasis: priceCents !== null ? "evidence" : "unknown",
    rationale: rationaleOverride ?? RATIONALE[candidate.category],
    confirmationRequired: needsAppearanceConfirmation,
    ...(needsAppearanceConfirmation
      ? { confirmationReason: "目录当前没有完整的外观颜色字段，建议确认白色版本或在高级 DIY 中替换。" }
      : {}),
  };
}

export function generateDesignProposal(input: DesignGenerationInput): DesignGenerationResult {
  // 已有硬件的类别不再生成购置候选（"我已有电源"→ 方案不含电源）
  const exclude = new Set(existingPartCategories(input.intent.existingParts));
  // 候选池由 buildCandidatePool 按排序名次产出（每类别内即排名序）；这里直接消费名次
  const byCategory = new Map<BuildItemCategory, CandidateSummary[]>();
  for (const candidate of input.candidates) {
    const bucket = byCategory.get(candidate.category);
    if (bucket) bucket.push(candidate);
    else byCategory.set(candidate.category, [candidate]);
  }

  const picked: Array<{ candidate: CandidateSummary; item: ProposalItem }> = [];
  const missingCategories: BuildItemCategory[] = [];
  for (const category of CATEGORY_ORDER) {
    if (exclude.has(category)) continue;
    const bucket = byCategory.get(category) ?? [];
    const preferredId = input.preferredIds?.[category];
    const candidate =
      (preferredId ? bucket.find((entry) => entry.canonicalId === preferredId) : undefined) ?? bucket[0];
    if (!candidate) {
      missingCategories.push(category);
      continue;
    }
    picked.push({
      candidate,
      item: candidateToItem(candidate, input.intent, input.qualityContextByCanonicalId?.get(candidate.canonicalId), input.rationaleByCategory?.[category]),
    });
  }

  if (picked.length === 0) {
    return { status: "insufficient", missingCategories };
  }

  // 规则检查在带字段质量层的瞬态配件上运行：质量不可用的字段只能得到 unknown 结论
  const transientItems: BuildItem[] = picked.map(({ candidate, item }) => {
    const parsed = buildItemInputSchema.parse({
      category: candidate.category,
      label: candidate.name,
      spec: candidate.spec,
      source: `catalog:${candidate.canonicalId}`,
    });
    return {
      ...parsed,
      id: randomUUID(),
      buildId: "proposal",
      createdAt: new Date().toISOString(),
      fieldQuality: Object.keys(item.fieldQuality).length > 0 ? item.fieldQuality : undefined,
    };
  });
  const findings = (input.compatibilityCheck ?? runBuildChecks)(transientItems);

  // 价格结论只汇总已审核证据价格；未计价件不按零元计入（与预算余量计同一纪律）
  const priced = picked.filter(({ item }) => item.priceEstimateLowCents !== null && item.priceEstimateHighCents !== null);
  const ranges = priced.reduce(
    (total, { item }) => ({
      low: total.low + (item.priceEstimateLowCents ?? 0),
      high: total.high + (item.priceEstimateHighCents ?? 0),
    }),
    { low: 0, high: 0 },
  );
  const estimatedLowCents = priced.length > 0 ? ranges.low : null;
  const estimatedHighCents = priced.length > 0 ? ranges.high : null;

  const compatibility = summarizeCompatibility(findings);
  const confirmationItems = picked.filter(({ item }) => item.confirmationRequired);
  const budget = input.intent.budgetCents;
  const excludedLabels = [...exclude].map((category) => CATEGORY_LABELS[category] ?? category);
  const missingLabels = missingCategories.map((category) => CATEGORY_LABELS[category] ?? category);
  const budgetFit =
    budget === null
      ? null
      : estimatedHighCents === null || estimatedLowCents === null
        ? "暂无已审核价格证据，预算结论待价格证据录入。"
        : estimatedHighCents <= budget
          ? "已审核价格合计在预算内，剩余空间可优先升级显卡或存储。"
          : estimatedLowCents > budget
            ? "已审核价格合计已超出预算，建议进入 DIY 下调显卡或存储档位。"
            : "价格合计横跨预算线，最终价格以购买前核实为准。";

  const unknowns = [
    estimatedLowCents === null
      ? "暂无已审核价格证据：价格上下限为空，不会用源码常量或经验值代替。"
      : "价格来自已审核证据快照，非实时成交价；购买前请再核实。",
    ...(missingLabels.length > 0
      ? [`以下类别暂无质量达标（verified/supported）的目录候选：${missingLabels.join("、")}。`]
      : []),
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
    summary: `根据“${input.intent.useCases.join("、") || "综合使用"}”和${input.intent.appearance.join("、") || "实用优先"}目标，从质量达标的目录候选中搭配出一套可编辑方案。`,
    budgetCents: input.intent.budgetCents,
    estimatedLowCents,
    estimatedHighCents,
    items: picked.map(({ item }) => item),
    fitNotes: [
      ...(input.intent.useCases.includes("视频剪辑") ? ["剪辑优先：保留较高的处理器、显卡和内存余量。"] : []),
      ...(input.intent.useCases.includes("游戏") ? ["游戏场景：显卡是主要预算与体验支点。"] : []),
      ...(input.intent.appearance.length > 0 ? [`外观方向：${input.intent.appearance.join("、")}。`] : []),
      ...(budgetFit ? [budgetFit] : []),
      ...(excludedLabels.length > 0
        ? [`已有硬件（${excludedLabels.join("、")}）未计入购置清单；建议在高级 DIY 中录入其型号以参与兼容检查。`]
        : []),
      ...(missingLabels.length > 0
        ? [`候选不足：${missingLabels.join("、")}没有通过质量门的目录候选，方案不含这些类别。`]
        : []),
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
  const categoryByItemId: Record<string, BuildItemCategory> = {};
  for (const item of transientItems) categoryByItemId[item.id] = item.category;
  return { status: "ok", proposal, findings, categoryByItemId };
}
