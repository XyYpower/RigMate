import type { BuildItemCategory } from "@/domain/build/types";
import type { DesignProposal, ProposalChange } from "@/contracts/design";

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

/**
 * 相邻版本差异（M32）：按类别对比两版方案的型号标签。
 * fromLabel/toLabel 为 null 表示该版本新增/不再购置；未变化的类别不出现。
 */
export function diffProposals(previous: DesignProposal | null, current: DesignProposal): ProposalChange[] {
  // 没有上一版就没有"变化"可言（首版不把所有件当作新增）
  if (!previous) return [];
  const before = new Map(previous.items.map((item) => [item.category, item.label]));
  const after = new Map(current.items.map((item) => [item.category, item.label]));
  const changes: ProposalChange[] = [];
  for (const category of CATEGORY_ORDER) {
    const fromLabel = before.get(category) ?? null;
    const toLabel = after.get(category) ?? null;
    if (fromLabel !== toLabel) changes.push({ category, fromLabel, toLabel });
  }
  return changes;
}
