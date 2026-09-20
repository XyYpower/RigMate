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
});

export const motherboardSpecSchema = z.object({
  socket: socketSchema.optional(),
  ramType: ramTypeSchema.optional(),
  formFactor: formFactorSchema.optional(),
  ramSlots: positiveIntSchema.optional(),
  m2Slots: countSchema.optional(),
  sataPorts: countSchema.optional(),
  pcieX16Slots: countSchema.optional(),
});

export const gpuSpecSchema = z.object({
  lengthMm: positiveIntSchema.optional(),
  tdpWatts: positiveIntSchema.optional(),
  pcie8pin: countSchema.optional(),
  twelveVhpwr: countSchema.optional(),
});

export const ramSpecSchema = z.object({
  ddrType: ramTypeSchema.optional(),
  sticks: positiveIntSchema.optional(),
});

export const storageSpecSchema = z.object({
  interface: storageInterfaceSchema.optional(),
});

export const psuSpecSchema = z.object({
  ratedWatts: positiveIntSchema.optional(),
  pcie8pin: countSchema.optional(),
  twelveVhpwr: countSchema.optional(),
});

export const coolerSpecSchema = z.object({
  supportedSockets: z.array(socketSchema).min(1).optional(),
  heightMm: positiveIntSchema.optional(),
});

export const caseSpecSchema = z.object({
  supportedFormFactors: z.array(formFactorSchema).min(1).optional(),
  maxGpuLengthMm: positiveIntSchema.optional(),
  maxCoolerHeightMm: positiveIntSchema.optional(),
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
