import { z } from "zod";

/**
 * BuildCores OpenDB 源记录校验（导入器第一道门，ADR §8.1-1）。
 *
 * 上游 schema 对自身字段有严格 enum/校验，这里只对**我们能消费的字段子集**做
 * 类型门禁：字段存在但类型不对 → 拒绝该记录（进 error 计数，不让坏数据混进目录）；
 * 我们不消费的字段直接忽略。字段名逐字对齐上游 schemas/*.schema.json。
 */

const nullableNumber = z.number().nullable().optional();
const nullableString = z.string().nullable().optional();

const metadataSchema = z.object({
  name: nullableString,
  manufacturer: nullableString,
  series: nullableString,
  variant: nullableString,
  part_numbers: z.array(z.string()).nullable().optional(),
});

const baseSourceSchema = z.object({
  /** UUID v4，且必须与文件名一致（上游规则，导入时复核） */
  opendb_id: z.string().trim().min(1),
  metadata: metadataSchema,
});

export const cpuSourceSchema = baseSourceSchema.extend({
  socket: nullableString,
  specifications: z
    .object({ tdp: nullableNumber, ppt: nullableNumber })
    .nullable()
    .optional(),
});

export const motherboardSourceSchema = baseSourceSchema.extend({
  socket: nullableString,
  form_factor: nullableString,
  memory: z
    .object({ ram_type: nullableString, slots: nullableNumber })
    .nullable()
    .optional(),
  pcie_slots: z
    .array(z.object({ quantity: nullableNumber, lanes: nullableNumber }))
    .nullable()
    .optional(),
  m2_slots: z.array(z.unknown()).nullable().optional(),
  storage_devices: z
    .object({ sata_6_gb_s: nullableNumber, sata_3_gb_s: nullableNumber })
    .nullable()
    .optional(),
});

export const gpuSourceSchema = baseSourceSchema.extend({
  tdp: nullableNumber,
  length: nullableNumber,
  power_connectors: z
    .object({
      pcie_8_pin: nullableNumber,
      pcie_12VHPWR: nullableNumber,
      pcie_12V_2x6: nullableNumber,
    })
    .nullable()
    .optional(),
});

export const ramSourceSchema = baseSourceSchema.extend({
  ram_type: nullableString,
  modules: z.object({ quantity: nullableNumber }).nullable().optional(),
});

export const storageSourceSchema = baseSourceSchema.extend({
  interface: nullableString,
});

export const psuSourceSchema = baseSourceSchema.extend({
  wattage: nullableNumber,
  connectors: z
    .object({ pcie_6_plus_2_pin: nullableNumber, pcie_12vhpwr: nullableNumber })
    .nullable()
    .optional(),
});

export const coolerSourceSchema = baseSourceSchema.extend({
  height: nullableNumber,
  water_cooled: z.boolean().nullable().optional(),
  cpu_sockets: z.array(z.string()).nullable().optional(),
});

export const caseSourceSchema = baseSourceSchema.extend({
  supported_motherboard_form_factors: z.array(z.string()).nullable().optional(),
  max_video_card_length: nullableNumber,
  max_cpu_cooler_height: nullableNumber,
});

export type CpuSourceRecord = z.infer<typeof cpuSourceSchema>;
export type MotherboardSourceRecord = z.infer<typeof motherboardSourceSchema>;
export type GpuSourceRecord = z.infer<typeof gpuSourceSchema>;
export type RamSourceRecord = z.infer<typeof ramSourceSchema>;
export type StorageSourceRecord = z.infer<typeof storageSourceSchema>;
export type PsuSourceRecord = z.infer<typeof psuSourceSchema>;
export type CoolerSourceRecord = z.infer<typeof coolerSourceSchema>;
export type CaseSourceRecord = z.infer<typeof caseSourceSchema>;
