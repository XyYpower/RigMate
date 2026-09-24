import type { BuildItemCategory } from "../build/types";
import { specSchemaByCategory } from "../build/specs";

/**
 * 标准型号种子目录（M17）
 *
 * 数据纪律（业务规格 §8.3 / §14.2）：
 * - 只收录公开资料可靠的高置信规格字段；拿不准的物理尺寸等字段**故意缺省**，
 *   带出后表单仍显示待补充，由用户补齐——绝不猜默认值；
 * - GPU 只带芯片级 TDP / 供电接口（官方数字），不带具体板卡长度；
 * - 本文件可整体替换：未来由 BuildCores 导入器（可审计、ODC-By 署名）或人工运营目录接管。
 */

export type CatalogEntry = {
  id: string;
  category: BuildItemCategory;
  name: string;
  aliases: string[];
  spec: Record<string, unknown>;
  /** 商品页链接（可选）；缺失时前端按型号拼京东搜索链接兜底 */
  refUrl?: string;
};

type RawEntry = Omit<CatalogEntry, "spec"> & { spec: Record<string, unknown> };

const RAW: RawEntry[] = [
  // ---- CPU ----
  { id: "cpu-9800x3d", category: "cpu", name: "AMD Ryzen 7 9800X3D", aliases: ["9800x3d", "x3d", "r7 9800"], spec: { socket: "AM5", tdpWatts: 120 } },
  { id: "cpu-7800x3d", category: "cpu", name: "AMD Ryzen 7 7800X3D", aliases: ["7800x3d", "x3d", "r7 7800"], spec: { socket: "AM5", tdpWatts: 120 } },
  { id: "cpu-9600x", category: "cpu", name: "AMD Ryzen 5 9600X", aliases: ["9600x", "r5 9600"], spec: { socket: "AM5", tdpWatts: 65 } },
  { id: "cpu-i5-14600kf", category: "cpu", name: "Intel Core i5-14600KF", aliases: ["14600kf", "i5-14600", "14600k"], spec: { socket: "LGA1700", tdpWatts: 125 } },
  { id: "cpu-i5-12400f", category: "cpu", name: "Intel Core i5-12400F", aliases: ["12400f", "i5-12400"], spec: { socket: "LGA1700", tdpWatts: 65 } },
  { id: "cpu-i7-14700k", category: "cpu", name: "Intel Core i7-14700K", aliases: ["14700k", "i7-14700"], spec: { socket: "LGA1700", tdpWatts: 125 } },
  // ---- 主板 ----
  { id: "mb-msi-b650m-mortar", category: "motherboard", name: "微星 MAG B650M MORTAR WIFI", aliases: ["b650m mortar", "迫击炮", "b650m"], spec: { socket: "AM5", ramType: "DDR5", formFactor: "mATX", ramSlots: 4, m2Slots: 2, sataPorts: 4, pcieX16Slots: 1 } },
  { id: "mb-asus-tuf-b650-plus", category: "motherboard", name: "华硕 TUF GAMING B650-PLUS WIFI", aliases: ["b650-plus", "tuf b650"], spec: { socket: "AM5", ramType: "DDR5", formFactor: "ATX", ramSlots: 4, m2Slots: 3, sataPorts: 4, pcieX16Slots: 1 } },
  { id: "mb-asrock-b650m-hdv", category: "motherboard", name: "华擎 B650M-HDV/M.2", aliases: ["b650m hdv"], spec: { socket: "AM5", ramType: "DDR5", formFactor: "mATX", ramSlots: 4, m2Slots: 2, sataPorts: 4, pcieX16Slots: 1 } },
  { id: "mb-gigabyte-b760m-elite", category: "motherboard", name: "技嘉 B760M AORUS ELITE AX", aliases: ["b760m", "小雕"], spec: { socket: "LGA1700", ramType: "DDR5", formFactor: "mATX", ramSlots: 4, m2Slots: 3, sataPorts: 4, pcieX16Slots: 1 } },
  { id: "mb-msi-pro-b760m-a", category: "motherboard", name: "微星 PRO B760M-A WIFI", aliases: ["b760m-a", "pro b760m"], spec: { socket: "LGA1700", ramType: "DDR5", formFactor: "mATX", ramSlots: 4, m2Slots: 2, sataPorts: 4, pcieX16Slots: 1 } },
  { id: "mb-asus-prime-b760-plus", category: "motherboard", name: "华硕 PRIME B760-PLUS", aliases: ["b760-plus", "prime b760"], spec: { socket: "LGA1700", ramType: "DDR5", formFactor: "ATX", ramSlots: 4, m2Slots: 3, sataPorts: 4, pcieX16Slots: 2 } },
  // ---- 内存 ----
  { id: "ram-kf-16-ddr5", category: "ram", name: "金士顿 FURY 野兽 16GB DDR5-5600", aliases: ["fury", "野兽16g", "kf556"], spec: { ddrType: "DDR5", sticks: 1 } },
  { id: "ram-kf-32-ddr5", category: "ram", name: "金士顿 FURY 野兽 32GB(2×16GB) DDR5-5600", aliases: ["fury", "野兽32g", "kf556"], spec: { ddrType: "DDR5", sticks: 2 } },
  { id: "ram-gskill-32-ddr5", category: "ram", name: "芝奇 幻锋戟 32GB(2×16GB) DDR5-6000", aliases: ["幻锋戟", "芝奇"], spec: { ddrType: "DDR5", sticks: 2 } },
  { id: "ram-xpg-16-ddr4", category: "ram", name: "威刚 XPG 威龙 16GB DDR4-3200", aliases: ["xpg", "威龙"], spec: { ddrType: "DDR4", sticks: 1 } },
  { id: "ram-gloway-32-ddr4", category: "ram", name: "光威 天策 32GB(2×16GB) DDR4-3200", aliases: ["天策", "光威"], spec: { ddrType: "DDR4", sticks: 2 } },
  // ---- 显卡（芯片级官方数字；板卡长度因品牌而异，故意缺省） ----
  { id: "gpu-rtx4090", category: "gpu", name: "NVIDIA RTX 4090（参考规格）", aliases: ["4090"], spec: { tdpWatts: 450, twelveVhpwr: 1, pcie8pin: 0 } },
  { id: "gpu-rtx4070s", category: "gpu", name: "NVIDIA RTX 4070 SUPER（参考规格）", aliases: ["4070s", "4070 super"], spec: { tdpWatts: 220, twelveVhpwr: 1, pcie8pin: 0 } },
  { id: "gpu-rtx4060", category: "gpu", name: "NVIDIA RTX 4060（参考规格）", aliases: ["4060"], spec: { tdpWatts: 115, pcie8pin: 1, twelveVhpwr: 0 } },
  { id: "gpu-rx7800xt", category: "gpu", name: "AMD RX 7800 XT（参考规格）", aliases: ["7800xt", "7800"], spec: { tdpWatts: 263, pcie8pin: 2, twelveVhpwr: 0 } },
  { id: "gpu-rx7600", category: "gpu", name: "AMD RX 7600（参考规格）", aliases: ["7600"], spec: { tdpWatts: 165, pcie8pin: 1, twelveVhpwr: 0 } },
  // ---- 电源 ----
  { id: "psu-sx-650", category: "psu", name: "振华 鑫铜 650W（80+ 铜牌）", aliases: ["鑫铜", "650w"], spec: { ratedWatts: 650, pcie8pin: 2, twelveVhpwr: 0 } },
  { id: "psu-gx-750", category: "psu", name: "海韵 FOCUS GX-750（80+ 金牌）", aliases: ["gx750", "海韵750"], spec: { ratedWatts: 750, pcie8pin: 4, twelveVhpwr: 0 } },
  { id: "psu-tuf-850-atx3", category: "psu", name: "华硕 TUF Gaming 850W Gold ATX 3.0", aliases: ["tuf 850", "tuf850"], spec: { ratedWatts: 850, pcie8pin: 2, twelveVhpwr: 1 } },
  // ---- 散热器 ----
  { id: "cooler-pa120se", category: "cooler", name: "利民 PA120 SE 双塔风冷", aliases: ["pa120", "利民风冷"], spec: { supportedSockets: ["AM4", "AM5", "LGA1700", "LGA1851"], heightMm: 155 } },
  { id: "cooler-ak400", category: "cooler", name: "九州风神 AK400 单塔风冷", aliases: ["ak400"], spec: { supportedSockets: ["AM4", "AM5", "LGA1700", "LGA1200"], heightMm: 155 } },
  { id: "cooler-frozen-prism-240", category: "cooler", name: "利民 Frozen Prism 240 一体式水冷", aliases: ["frozen prism", "水冷240"], spec: { supportedSockets: ["AM5", "LGA1700", "LGA1851"] } },
  // ---- 存储 ----
  { id: "ssd-990pro-1t", category: "storage", name: "三星 990 PRO 1TB（M.2 NVMe）", aliases: ["990pro", "990 pro"], spec: { interface: "m2_nvme" } },
  { id: "ssd-rc20-1t", category: "storage", name: "铠侠 RC20 1TB（M.2 NVMe）", aliases: ["rc20"], spec: { interface: "m2_nvme" } },
  { id: "ssd-sn770-1t", category: "storage", name: "西部数据 SN770 1TB（M.2 NVMe）", aliases: ["sn770", "黑盘"], spec: { interface: "m2_nvme" } },
  { id: "ssd-870evo-500g", category: "storage", name: "三星 870 EVO 500GB（SATA）", aliases: ["870evo", "870 evo"], spec: { interface: "sata" } },
  // ---- 机箱 ----
  { id: "case-pingtouge-m2", category: "case", name: "先马 平头哥 M2", aliases: ["平头哥"], spec: { supportedFormFactors: ["mATX", "ITX"], maxGpuLengthMm: 330, maxCoolerHeightMm: 169 } },
  { id: "case-gt502", category: "case", name: "华硕 TUF Gaming GT502 弹药库", aliases: ["弹药库", "gt502"], spec: { supportedFormFactors: ["ATX", "mATX", "ITX", "E-ATX"], maxGpuLengthMm: 400, maxCoolerHeightMm: 180 } },
];

/** 加载即校验：任何不符合类别 schema 的种子直接抛错（坏数据不让它上线） */
export const CATALOG: CatalogEntry[] = RAW.map((entry) => {
  const schema = specSchemaByCategory[entry.category];
  return { ...entry, spec: schema.parse(entry.spec) };
});
