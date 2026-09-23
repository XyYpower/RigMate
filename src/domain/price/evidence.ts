import { z } from "zod";
import { buildItemCategorySchema } from "../build/types";

/**
 * 价格证据（规格 §8.2）：追加式快照，不覆盖、不修改。
 * V1 只启用手动来源（manual_entry）；每条必须能回答"什么时间、在哪、多少钱、什么口径"。
 */

export const priceEvidenceSourceSchema = z.enum(["manual_entry", "user_submission"]);
export type PriceEvidenceSource = z.infer<typeof priceEvidenceSourceSchema>;

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
  evidenceUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  note: z.string().trim().max(300).optional(),
  /** 价格对应的时间（用户录入；缺省 = 录入时刻） */
  capturedAt: z.string().datetime().optional(),
});

export type PriceEvidenceInput = z.infer<typeof priceEvidenceInputSchema>;

export type PriceEvidenceRecord = PriceEvidenceInput & {
  id: string;
  createdAt: string;
  /** 归一后的实际快照时间 */
  capturedAt: string;
};
