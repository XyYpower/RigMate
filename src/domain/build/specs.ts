import { z } from "zod";

export const ramTypeSchema = z.enum(["DDR4", "DDR5"]);

export const formFactorSchema = z.enum(["E-ATX", "ATX", "mATX", "ITX"]);

export const storageInterfaceSchema = z.enum(["m2_nvme", "sata"]);

const positiveIntSchema = z.number().int().positive();
const countSchema = z.number().int().nonnegative();
const socketSchema = z.string().trim().min(1).max(40);

export const cpuSpecSchema = z.object({
  socket: socketSchema.optional(),
  tdpWatts: positiveIntSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const motherboardSpecSchema = z.object({
  socket: socketSchema.optional(),
  ramType: ramTypeSchema.optional(),
  formFactor: formFactorSchema.optional(),
  ramSlots: positiveIntSchema.optional(),
  m2Slots: countSchema.optional(),
  sataPorts: countSchema.optional(),
  pcieX16Slots: countSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const gpuSpecSchema = z.object({
  lengthMm: positiveIntSchema.optional(),
  tdpWatts: positiveIntSchema.optional(),
  pcie8pin: countSchema.optional(),
  twelveVhpwr: countSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const ramSpecSchema = z.object({
  ddrType: ramTypeSchema.optional(),
  sticks: positiveIntSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const storageSpecSchema = z.object({
  interface: storageInterfaceSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const psuSpecSchema = z.object({
  ratedWatts: positiveIntSchema.optional(),
  pcie8pin: countSchema.optional(),
  twelveVhpwr: countSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const coolerSpecSchema = z.object({
  supportedSockets: z.array(socketSchema).min(1).optional(),
  heightMm: positiveIntSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const caseSpecSchema = z.object({
  supportedFormFactors: z.array(formFactorSchema).min(1).optional(),
  maxGpuLengthMm: positiveIntSchema.optional(),
  maxCoolerHeightMm: positiveIntSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const specSchemaByCategory = {
  cpu: cpuSpecSchema,
  motherboard: motherboardSpecSchema,
  gpu: gpuSpecSchema,
  ram: ramSpecSchema,
  storage: storageSpecSchema,
  psu: psuSpecSchema,
  cooler: coolerSpecSchema,
  case: caseSpecSchema,
} as const;

/**
 * 八类配件决策字段的并集（适配器层按类别产出，最终仍由 specSchemaByCategory 校验）。
 * 采集适配器先产出宽类型，交给 schema 兜底——与"加载即校验，坏数据不上线"同一条纪律。
 */
export type SpecRecord = Partial<
  z.infer<typeof cpuSpecSchema> &
    z.infer<typeof motherboardSpecSchema> &
    z.infer<typeof gpuSpecSchema> &
    z.infer<typeof ramSpecSchema> &
    z.infer<typeof storageSpecSchema> &
    z.infer<typeof psuSpecSchema> &
    z.infer<typeof coolerSpecSchema> &
    z.infer<typeof caseSpecSchema>
>;
