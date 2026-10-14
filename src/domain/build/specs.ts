import { z } from "zod";

export const ramTypeSchema = z.enum(["DDR4", "DDR5"]);

export const formFactorSchema = z.enum(["E-ATX", "ATX", "mATX", "ITX"]);

export const storageInterfaceSchema = z.enum(["m2_nvme", "sata"]);

const positiveIntSchema = z.number().int().positive();
const booleanSchema = z.boolean();
const countSchema = z.number().int().nonnegative();
const socketSchema = z.string().trim().min(1).max(40);

export const cpuSpecSchema = z.object({
  socket: socketSchema.optional(),
  tdpWatts: positiveIntSchema.optional(),
  /** PTP 瞬时最大功耗（数据集口径：散热与整机功耗按此，不按 TDP） */
  ptpMaxWatts: positiveIntSchema.optional(),
  /** CPU 直连 M.2 通道数：插槽数超过它时其余走芯片组（带宽受限） */
  m2Lanes: countSchema.optional(),
  hasIgpu: booleanSchema.optional(),
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
  /** VRM 供电评分（相数×安数，数据集口径 400-2860）：衡量主板能带多高的 CPU 功耗 */
  vrmScore: positiveIntSchema.optional(),
  /** 官方标称支持的 CPU 功耗上限 */
  targetCpuTdpWatts: positiveIntSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const gpuSpecSchema = z.object({
  lengthMm: positiveIntSchema.optional(),
  tdpWatts: positiveIntSchema.optional(),
  pcie8pin: countSchema.optional(),
  twelveVhpwr: countSchema.optional(),
  vramGb: positiveIntSchema.optional(),
  perfScore: countSchema.optional(),
  tier: countSchema.optional(),
});

export const ramSpecSchema = z.object({
  ddrType: ramTypeSchema.optional(),
  sticks: positiveIntSchema.optional(),
  /** 内存马甲高度（mm）：与散热器内存避让间隙比较 */
  heightMm: positiveIntSchema.optional(),
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
  /** 内存避让间隙（mm）：塔背到第一风扇的空间，内存马甲高度超过它即冲突 */
  memoryClearanceMm: positiveIntSchema.optional(),
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
