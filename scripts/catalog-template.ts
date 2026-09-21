import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MANUAL_CSV_HEADERS } from "../src/infra/catalog-import/manual-csv";

/**
 * 生成人工目录 CSV 模板（预填 samples/目录收录候选.md 的型号清单）。
 * 用法：npm run catalog-template  →  data/catalog/人工目录模板.csv
 *
 * 预填纪律：型号/类别/别名/确定无疑的字段（来自 11 份真实样本的名称与公开规格）直接填；
 * 没把握的字段一律留空——"不确定就空着，绝不猜"，空格不影响导入。
 * 用户在 Excel 里核对/补空后另存为「CSV UTF-8」，再跑 npm run import-manual。
 */

type Row = (string | undefined)[];

function row(
  name: string,
  category: string,
  aliases: string,
  fields: Partial<Record<(typeof MANUAL_CSV_HEADERS)[number], string | number>> = {},
): Row {
  return MANUAL_CSV_HEADERS.map((header) => {
    if (header === "型号（必填）") return name;
    if (header === "类别（必填）") return category;
    if (header === "别名（检索用，分号分隔）") return aliases;
    return fields[header] !== undefined ? String(fields[header]) : "";
  });
}

const AM5_SOCKETS = "AM5;LGA1700;LGA1851";

const PREFILL: Row[] = [
  // ---- 主板（插槽/代际/板型来自型号命名事实；槽数留空待查证）----
  row("技嘉 B650M K", "主板", "b650m k", { 插槽: "AM5", 板型: "mATX", 内存代际: "DDR5" }),
  row("技嘉 B850 A ELITE WF7 小雕", "主板", "b850 小雕;小雕", { 插槽: "AM5", 板型: "ATX", 内存代际: "DDR5" }),
  row("技嘉 X870 A ELITE WIFI7 ICE 冰雕", "主板", "x870 冰雕;冰雕", { 插槽: "AM5", 板型: "ATX", 内存代际: "DDR5" }),
  row("技嘉 B850M FORCE WIFI6E 战鹰", "主板", "b850m force;战鹰", { 插槽: "AM5", 板型: "mATX", 内存代际: "DDR5" }),
  row("技嘉 B840M FORCE 战鹰 WIFI6E", "主板", "b840m force", { 插槽: "AM5", 板型: "mATX", 内存代际: "DDR5" }),
  row("华硕 PRIME B650EM-A WIFI6", "主板", "b650em-a;prime b650em", { 插槽: "AM5", 板型: "mATX", 内存代际: "DDR5" }),
  // ---- 显卡（芯片级 TDP/供电为官方数字；板长留空待查证）----
  row("华硕 DUAL RTX 5070 O12G 雪豹", "显卡", "5070 雪豹;雪豹", { "TDP功率W": 250, "12VHPWR口数": 1 }),
  row("技嘉 RTX 5070 EAGLE ICE O12G 冰猎鹰", "显卡", "冰猎鹰;eagle ice", { "TDP功率W": 250, "12VHPWR口数": 1 }),
  row("技嘉 RTX5070 EAGLE SFF 12G OC 猎鹰", "显卡", "eagle sff;猎鹰", { "TDP功率W": 250, "12VHPWR口数": 1 }),
  row("技嘉 RTX5060Ti WINDFORCE OC 8G 风魔 MAX", "显卡", "5060ti 风魔;风魔", { "TDP功率W": 180, "12VHPWR口数": 1 }),
  row("七彩虹 iGame RTX 4080 SUPER 火神 OC", "显卡", "4080s 火神;火神", { "TDP功率W": 320, "12VHPWR口数": 1 }),
  row("技嘉 RX9070GRE GAMING OC 12G 魔鹰", "显卡", "9070gre;魔鹰", { "TDP功率W": 220, "12VHPWR口数": 1 }),
  // ---- 电源（额定功率来自型号命名；接口数留空待查证）----
  row("鑫谷 无界PRO 850W 金牌全模 日系电容", "电源", "无界pro;无界850", { "额定功率W": 850 }),
  row("鑫谷 无界PRO 750W 金牌全模 日系电容", "电源", "无界pro 750", { "额定功率W": 750 }),
  row("技嘉 风魔 P650GS 650W 氮化镓金牌 ATX3.1", "电源", "p650gs", { "额定功率W": 650 }),
  row("技嘉 P750GS 750W 金牌 日系电容 氮化镓", "电源", "p750gs", { "额定功率W": 750 }),
  row("机械大师 FX850 850W 金牌全模组", "电源", "fx850", { "额定功率W": 850 }),
  row("航嘉 MVP K850 850W 金牌全模 ATX3.1", "电源", "k850;mvp k850", { "额定功率W": 850 }),
  row("航嘉 WD750Evo炫金战神 750W 金牌 ATX3.1", "电源", "wd750evo", { "额定功率W": 750 }),
  row("骨伽 VTE X2 750W 铜牌 ATX3.1", "电源", "vte x2", { "额定功率W": 750 }),
  // ---- 机箱（支持板型来自产品线事实；限长/限高留空待查证）----
  row("骨伽 FV160 海景房", "机箱", "fv160", { 板型: "ATX;mATX;ITX" }),
  row("乔思伯 X400 ATX海景房", "机箱", "x400", { 板型: "ATX;mATX;ITX" }),
  row("鑫谷 U503 无立柱海景房", "机箱", "u503", { 板型: "ATX;mATX;ITX" }),
  row("联力 包豪斯O11 Vision Compact", "机箱", "包豪斯;o11 vision compact", { 板型: "ATX;mATX;ITX" }),
  row("航嘉 S980 龙卷风 全景无立柱", "机箱", "s980", { 板型: "ATX;mATX;ITX" }),
  row("华硕 海王星EVO 无立柱全视海景房", "机箱", "海王星", { 板型: "ATX;mATX;ITX" }),
  row("瓦尔基里 VK03-M LCD触摸屏", "机箱", "vk03-m;瓦尔基里vk03", { 板型: "mATX;ITX" }),
  row("SAHARA 魔蛇MG520 无立柱海景房", "机箱", "魔蛇;mg520", { 板型: "ATX;mATX;ITX" }),
  row("追风者 XT M3 风道机箱", "机箱", "xtm3;xt m3", { 板型: "mATX;ITX" }),
  // ---- 散热（360 水冷高度不适用；风冷高度留空待查证）----
  row("超频三 DX360 双4寸屏显 360水冷", "散热器", "dx360", { "支持插槽(散热器)": AM5_SOCKETS }),
  row("超频三 DA360PRO ARGB 可旋转冷头", "散热器", "da360pro", { "支持插槽(散热器)": AM5_SOCKETS }),
  row("利民 MV360 ARGB 雷神之锤 360水冷", "散热器", "mv360;雷神之锤", { "支持插槽(散热器)": AM5_SOCKETS }),
  row("利民 冰封无限360 水冷", "散热器", "冰封无限", { "支持插槽(散热器)": AM5_SOCKETS }),
  row("钛钽 A080 360一体式水冷", "散热器", "a080;钛钽", { "支持插槽(散热器)": AM5_SOCKETS }),
  row("瓦尔基里 GLA360 智能数显屏 水冷", "散热器", "gla360;瓦尔基里", { "支持插槽(散热器)": AM5_SOCKETS }),
  row("酷里奥 A60 六热管双塔风冷", "散热器", "a60;coolleo", {}),
  // ---- 内存（条数来自样本清单）----
  row("威刚 XPG D300 24G 6000 马甲条", "内存", "d300;xpg d300", { 内存代际: "DDR5", 内存条数: 1 }),
  row("金泰克 朱砂痣 16G 6000 C36", "内存", "朱砂痣", { 内存代际: "DDR5", 内存条数: 1 }),
  row("金泰克 阿KIM星际 16G 6000 C36", "内存", "阿kim星际", { 内存代际: "DDR5", 内存条数: 1 }),
  row("金泰克 速虎 24G 6000 三星颗粒", "内存", "速虎24g", { 内存代际: "DDR5", 内存条数: 1 }),
  row("佰维 DX100 32G(16×2) 6000 C28 灯条", "内存", "dx100;佰维32g", { 内存代际: "DDR5", 内存条数: 2 }),
  row("十铨 幻境 32G(16×2) 6000 C28 灯条", "内存", "幻境;teamgroup 幻境", { 内存代际: "DDR5", 内存条数: 2 }),
  row("十铨 火神 32G(16×2) 6000 C28", "内存", "火神;vulcan", { 内存代际: "DDR5", 内存条数: 2 }),
  row("储奇 玄奘 32G 6000 C40 单根", "内存", "玄奘", { 内存代际: "DDR5", 内存条数: 1 }),
  row("宏碁掠夺者 炫光星舰 32G(16×2) 6800 C34", "内存", "炫光星舰;掠夺者内存", { 内存代际: "DDR5", 内存条数: 2 }),
  // ---- SSD（接口来自型号事实）----
  row("金泰克 速虎TP5000 1T PCIE4.0", "SSD", "速虎;tp5000", { "接口(SSD)": "NVMe" }),
  row("雷克沙 ARES 战神 1T 7400MB/s", "SSD", "ares;战神", { "接口(SSD)": "NVMe" }),
  row("雷克沙 NQ790 1T 7000MB/s", "SSD", "nq790", { "接口(SSD)": "NVMe" }),
  row("梵想 S790 1TB 7400MB/s", "SSD", "s790;梵想", { "接口(SSD)": "NVMe" }),
];

function csvField(value: string): string {
  return value.includes(",") || value.includes('"') || value.includes("\n")
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

const lines = [
  MANUAL_CSV_HEADERS.join(","),
  ...PREFILL.map((rowCells) => rowCells.map((cell) => csvField(cell ?? "")).join(",")),
];
// BOM：让 Excel 双击打开不乱码
const content = "\uFEFF" + lines.join("\r\n") + "\r\n";

const outPath = join(process.cwd(), "data", "catalog", "人工目录模板.csv");
mkdirSync(join(outPath, ".."), { recursive: true });
writeFileSync(outPath, content, { encoding: "utf8" });

console.log(`模板已生成（预填 ${PREFILL.length} 行）：${outPath}`);
console.log("接下来：");
console.log("  1. 用 Excel 打开核对/补空（不确定的留空即可，空 = 不带出该字段）");
console.log("  2. 另存为「CSV UTF-8 (逗号分隔)(*.csv)」，保持原文件名");
console.log("  3. 运行 npm run import-manual 导入（任何一行有问题会整包拒绝并逐行报错）");
