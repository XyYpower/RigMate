import { z } from "zod";
import {
  caseSpecSchema,
  coolerSpecSchema,
  cpuSpecSchema,
  gpuSpecSchema,
  motherboardSpecSchema,
  psuSpecSchema,
  ramSpecSchema,
  storageSpecSchema,
} from "./specs";

export const buildItemCategorySchema = z.enum([
  "cpu",
  "motherboard",
  "gpu",
  "ram",
  "storage",
  "psu",
  "cooler",
  "case",
]);

export const buildStatusSchema = z.enum([
  "draft",
  "needs_confirmation",
  "ready",
  "checking",
  "reviewed",
  "stale",
  "archived",
]);

export const findingStatusSchema = z.enum([
  "pass",
  "block",
  "warn",
  "unknown",
  "not_applicable",
]);

export const createBuildInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  useCase: z.string().trim().max(120).optional(),
  budgetCents: z.number().int().nonnegative().nullable().optional(),
});

const labelSchema = z.string().trim().min(1).max(160);
const sourceSchema = z.string().trim().max(500);
const priceCentsSchema = z.number().int().positive();

const itemBaseSchema = {
  label: labelSchema,
  source: sourceSchema.optional(),
  priceCents: priceCentsSchema.optional(),
};

export const buildItemInputSchema = z.discriminatedUnion("category", [
  z.object({
    category: z.literal("cpu"),
    ...itemBaseSchema,
    spec: cpuSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("motherboard"),
    ...itemBaseSchema,
    spec: motherboardSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("gpu"),
    ...itemBaseSchema,
    spec: gpuSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("ram"),
    ...itemBaseSchema,
    spec: ramSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("storage"),
    ...itemBaseSchema,
    spec: storageSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("psu"),
    ...itemBaseSchema,
    spec: psuSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("cooler"),
    ...itemBaseSchema,
    spec: coolerSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("case"),
    ...itemBaseSchema,
    spec: caseSpecSchema.default({}),
  }),
]);

export type BuildItemCategory = z.infer<typeof buildItemCategorySchema>;
export type BuildStatus = z.infer<typeof buildStatusSchema>;
export type FindingStatus = z.infer<typeof findingStatusSchema>;
export type CreateBuildInput = z.infer<typeof createBuildInputSchema>;
export type BuildItemInput = z.infer<typeof buildItemInputSchema>;

export type BuildItem = BuildItemInput & {
  id: string;
  buildId: string;
  createdAt: string;
};

export type Build = {
  id: string;
  name: string;
  useCase: string | null;
  budgetCents: number | null;
  status: BuildStatus;
  createdAt: string;
  updatedAt: string;
  items: BuildItem[];
  /** 由服务层按业务规格 §10.1 计算附带；非持久化字段 */
  budgetSummary?: BudgetSummary;
};

/** 业务规格 §10.1：预算结论。未知金额不按零元计入（differenceCents 仅基于已计价部分） */
export type BudgetSummary = {
  budgetCents: number | null;
  pricedTotalCents: number;
  pricedCount: number;
  unpricedCount: number;
  unpricedLabels: string[];
  /** 预算 − 已计价总额；未设置预算时为 null。未计价件不参与该差值 */
  differenceCents: number | null;
};

export type Finding = {
  ruleId: string;
  status: FindingStatus;
  itemIds: string[];
  conclusion: string;
  evidence: string[];
  dataDate: string | null;
  confidence: "high" | "medium" | "low";
  assumptions: string[];
  missingFields: string[];
  suggestedAction: string;
};
