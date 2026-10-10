import { z } from "zod";
import { buildItemCategorySchema } from "../build/types";

/**
 * 价格证据（规格 §8.2）：追加式快照，不覆盖、不修改。
 * V1 只启用手动来源（manual_entry）；每条必须能回答"什么时间、在哪、多少钱、什么口径"。
 * 价格与规格严格隔离（实施计划 Task 8）：canonicalId 只做关联，
 * 价格的审核状态独立于规格质量状态，价格永远不会写入/提升 spec 的 verified。
 */

export const priceEvidenceSourceSchema = z.enum([
  "manual_entry",
  "user_submission",
  /** 平台开放 API 采集（如京东联盟 goods.query）：机器采集未经人工，入账即 unreviewed */
  "platform_api",
]);
export type PriceEvidenceSource = z.infer<typeof priceEvidenceSourceSchema>;

/** 价格审核状态：与规格字段质量状态完全独立（价格核对通过 ≠ 规格已核验） */
export const priceReviewStatusSchema = z.enum(["unreviewed", "verified", "rejected"]);
export type PriceReviewStatus = z.infer<typeof priceReviewStatusSchema>;

export const priceEvidenceInputSchema = z.object({
  category: buildItemCategorySchema,
  productName: z.string().trim().min(1).max(160),
  priceCents: z.number().int().positive(),
  /** 价格口径：标价 / 到手价 / 券后价（可空 = 未注明） */
  priceBasis: z.string().trim().max(30).optional(),
  sourceType: priceEvidenceSourceSchema,
  platform: z.string().trim().max(60).optional(),
  shop: z.string().trim().max(120).optional(),
  /** 商品状态：全新 / 散片 / 二手 等 */
  condition: z.string().trim().max(30).optional(),
  /** 关联目录条目 id（可空：目录未收录也能记价格） */
  canonicalProductId: z.string().trim().max(80).optional(),
  /** 价格地区；缺省按"中国大陆"理解 */
  region: z.string().trim().max(40).optional(),
  evidenceUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  note: z.string().trim().max(300).optional(),
  /** 价格对应的时间（用户录入；缺省 = 录入时刻） */
  capturedAt: z.string().datetime().optional(),
});

export type PriceEvidenceInput = z.infer<typeof priceEvidenceInputSchema>;

export type PriceEvidenceRecord = PriceEvidenceInput & {
  id: string;
  createdAt: string;
  reviewStatus: PriceReviewStatus;
  /** 归一后的实际快照时间 */
  capturedAt: string;
};
