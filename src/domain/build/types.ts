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

export const buildItemInputSchema = z.discriminatedUnion("category", [
  z.object({
    category: z.literal("cpu"),
    label: labelSchema,
    source: sourceSchema.optional(),
    spec: cpuSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("motherboard"),
    label: labelSchema,
    source: sourceSchema.optional(),
    spec: motherboardSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("gpu"),
    label: labelSchema,
    source: sourceSchema.optional(),
    spec: gpuSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("ram"),
    label: labelSchema,
    source: sourceSchema.optional(),
    spec: ramSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("storage"),
    label: labelSchema,
    source: sourceSchema.optional(),
    spec: storageSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("psu"),
    label: labelSchema,
    source: sourceSchema.optional(),
    spec: psuSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("cooler"),
    label: labelSchema,
    source: sourceSchema.optional(),
    spec: coolerSpecSchema.default({}),
  }),
  z.object({
    category: z.literal("case"),
    label: labelSchema,
    source: sourceSchema.optional(),
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
