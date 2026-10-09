import type { VerifiedPriceFact } from "@/domain/catalog/ranking";
import { listVerifiedPriceEvidence } from "@/infra/db/repositories/price-evidence-repository";

/**
 * 方案价格上下文（内核恢复计划 Task C）。
 *
 * 纪律：
 * - 只有 review_status = verified 的价格能进入正式方案的估算区间；
 * - unreviewed / rejected 价格不参与任何预算结论；
 * - 地区必须匹配（缺省按"中国大陆"），跨地区价格不得混入；
 * - 同一产品多条已审核价格时取最新快照（追加式台账：旧价格永远保留但不覆盖新结论），
 *   其证据行 id 一并透出以便回溯。
 */
export function loadPriceContext(options: { region?: string | null } = {}): Map<string, VerifiedPriceFact> {
  const region = options.region?.trim() || "中国大陆";
  const context = new Map<string, VerifiedPriceFact>();
  for (const row of listVerifiedPriceEvidence({ region })) {
    if (!row.canonicalProductId) continue;
    const existing = context.get(row.canonicalProductId);
    // 列表按 capturedAt 倒序返回：首条即最新快照；同产品其余证据 id 合并透出
    if (!existing) {
      context.set(row.canonicalProductId, {
        canonicalProductId: row.canonicalProductId,
        priceCents: row.priceCents,
        evidenceIds: [row.id],
        capturedAt: row.capturedAt,
      });
      continue;
    }
    existing.evidenceIds.push(row.id);
  }
  return context;
}
