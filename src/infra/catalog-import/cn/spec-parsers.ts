import type { BuildItemCategory } from "@/domain/build/types";
import { specSchemaByCategory, type SpecRecord } from "@/domain/build/specs";
import type { FieldEvidence, LabeledValue } from "./contract";
import { labelValuePairs } from "./contract";

/**
 * 大陆官网规格页 → RigMate 决策字段的**共享映射**。
 *
 * 各家官网页面结构不同，但规格标签的中文说法高度一致（"内存插槽""M.2""显卡尺寸"…）。
 * 把这层抽出来之后，新增品牌只写「发现 URL + 提取身份」两件事，字段映射直接复用。
 *
 * 纪律：
 * - **只认页面明确写出的值**，解析不到就留空——绝不用同系列/同模具推断；
 * - 每个填上的字段都带原文摘录，供字段级证据链复核；
 * - 数量类字段识别 0 是合法值（"仅 12VHPWR 供电，8pin=0"是事实），不能当成"没写"。
 */

/** 中文标签 → 提取函数的映射表；按类别分 */
type Extractor = (value: string, label: string, pairs: LabeledValue[]) => unknown;

type FieldRule = {
  field: string;
  /** 标签匹配：正则，忽略大小写与空白 */
  labels: RegExp;
  extract: Extractor;
  /** 多条命中时是否取"最后一个"（有些站点先写概览再写精确值） */
  preferLast?: boolean;
  /**
   * 数组字段：把所有命中标签的值**合并**而不是只取一个。
   * 微星散热器的插槽分散在 "Intel Socket" 与 "AMD Socket" 两行，
   * 只取第一个会漏掉 AM5/AM4 ——那会让"支持插槽"少一半还看不出错。
   */
  mergeArrays?: boolean;
};

/**
 * 字段取值合理区间——**安全阀，不是校验**。
 *
 * 为什么必须加：标签写错或页面结构变化时，解析器会写出"看起来合理、实际错误"
 * 的值（例如把 供电接口 的 8 当成 8pin 数量、把版本号 43 当成显卡长度）。
 * 这种值一旦带上 S1 厂商来源标记，就会通过质量门去驱动兼容性规则——
 * **比缺字段危险得多**。所以越界的值一律丢弃，宁可让字段留空。
 */
const PLAUSIBLE_RANGES: Record<string, [number, number]> = {
  // 显卡长度 / 机箱显卡限长：现实中最短的整卡也在 140mm 以上；
  // 下限设 40 时 "43 x 112 x 20 mm"（其实是高度三围）会被当成合法长度放行。
  lengthMm: [140, 800],
  heightMm: [10, 400],
  maxGpuLengthMm: [100, 1200],
  maxCoolerHeightMm: [50, 600],
  tdpWatts: [5, 2000],
  ratedWatts: [50, 2500],
  pcie8pin: [0, 8],
  twelveVhpwr: [0, 4],
  ramSlots: [1, 8],
  m2Slots: [0, 16],
  sataPorts: [0, 24],
  pcieX16Slots: [0, 8],
  sticks: [1, 8],
};

/** 越界就丢弃该值（字段留空），绝不"取个接近的数" */
function withinPlausible(field: string, value: unknown): boolean {
  if (typeof value !== "number") return true;
  const range = PLAUSIBLE_RANGES[field];
  if (!range) return true;
  return value >= range[0] && value <= range[1];
}

/**
 * 归一化：压掉空白；只剥掉**纯单位**的括号标记。
 *
 * 早期版本用 /\(.*?\)/ 把括号内容整段删掉，结果把 "32GB (2 x 16GB) DDR5" 的
 * 容量组成一起吃掉——那正是判断内存条数的关键信息。只删 (mm)/(W)/(GB) 这类
 * 单位标记是安全的；带数字的括号必须保留。
 */
const squash = (value: string): string =>
  value
    .replace(/\s+/g, "")
    .replace(/[（(](?:mm|cm|毫米|厘米|w|watts?|gb|tb|inch|英寸|pin)(?:[）)])/gi, "");

/** 第一个整数 */
function firstInt(value: string): number | undefined {
  const match = squash(value).match(/\d+(\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

/**
 * 数量类：抓"数量 × 规格"里的第一个数。
 * "4 x DDR5 内存插槽" → 4；"支持 4 个 M.2 插槽" → 4；"8GB GDDR6" → 8。
 */
function count(value: string): number | undefined {
  return firstInt(value);
}

/**
 * 尺寸 → 毫米。
 *
 * 页面常写三围 "267 x 111 x 40 mm"（单位只写在末尾，修饰三个数），
 * 这时要取**第一个**数（长度），而不是紧贴单位那个数（高度）——
 * 否则 267x111x40 会被读成 40，把显卡长度写成散热器高度。
 */
function lengthMm(value: string): number | undefined {
  const s = squash(value);
  // 三围形式：数字 x 数字 x 数字 单位
  const triple = /^(\d+(?:\.\d+)?)[x×*]\d+(?:[x×*]\d+(?:\.\d+)?)?(mm|毫米|cm|厘米|inch|英寸)$/i.exec(s);
  if (triple) {
    const raw = Number(triple[1]);
    return Number.isFinite(raw) ? toMm(raw, triple[2]!) : undefined;
  }
  const single = /(\d+(?:\.\d+)?)(mm|毫米|cm|厘米|inch|英寸)/i.exec(s);
  if (!single) return undefined;
  const raw = Number(single[1]);
  return Number.isFinite(raw) ? toMm(raw, single[2]!) : undefined;
}

function toMm(raw: number, unit: string): number {
  const mm = /cm|厘米/i.test(unit) ? raw * 10 : /inch|英寸/i.test(unit) ? raw * 25.4 : raw;
  return Math.ceil(mm);
}

/**
 * 归一化插槽：AM5 / LGA1700 / LGA 1700 → "AM5" / "LGA1700"。
 *
 * 页面上常写成 "AMD Socket AM4"、"Socket AM5"，插槽代号只是**其中一个词**，
 * 所以要在整串里搜索，不能整串精确匹配。
 */
export function normalizeSocket(value: string): string | undefined {
  const am = /\bAM[345]\b/i.exec(value);
  if (am) return am[0].toUpperCase();
  const lga = /\bLGA\s?(\d{4,5})\b/i.exec(value);
  if (lga) return `LGA${lga[1]}`;
  return undefined;
}

/** 归一化板型 */
export function normalizeFormFactor(value: string): "E-ATX" | "ATX" | "mATX" | "ITX" | undefined {
  const s = squash(value).toUpperCase().replace(/-/g, "");
  if (s === "EATX") return "E-ATX";
  if (s === "ATX") return "ATX";
  if (s === "MATX" || s === "MICROATX") return "mATX";
  if (s === "ITX" || s === "MINIITX") return "ITX";
  return undefined;
}

/**
 * 供电接口计数。页面上常见 "1 x 8pin + 3 x 8pin" / "12VHPWR x 1" / "2+2 x8pin"。
 * 这里只数**明确写成 pin 的供电**，不把 PCIe 插槽当成供电。
 * 若值里根本没有 "pin" 字样，一律返回 undefined——宁可留空也不猜 0：
 * "0" 与"没写"语义不同（0 是事实，留空是未知）。
 */
function powerConnectorCount(value: string, needle: "8pin" | "12v"): number | undefined {
  const s = squash(value).toLowerCase();
  if (needle === "12v") {
    if (!/12v-?(?:hpwr|awg|2x6)/.test(s)) return undefined;
    const explicit = s.match(/(\d+)?\s*x?\s*12v-?(?:hpwr|awg|2x6)/g);
    if (!explicit) return 1;
    return explicit.reduce((sum, token) => {
      const n = Number(token.match(/(\d+)/)?.[1] ?? 1);
      return sum + (Number.isFinite(n) ? n : 1);
    }, 0);
  }
  if (!s.includes("pin")) return undefined;
  // 两种写法都要认：数量在前 "1 x 8pin"、规格在前 "8-pin x 1"（微星就是后者）。
  // 只认一种会把 "8-pin x 1" 读成 8 个接口。
  const pattern = /(\d+)\s*x\s*(?:pcie\s*)?8-?pin|8-?pin\s*x\s*(\d+)/gi;
  let total = 0;
  let matched = false;
  for (const match of s.matchAll(pattern)) {
    matched = true;
    const count = Number(match[1] ?? match[2] ?? 1);
    total += Number.isFinite(count) ? count : 1;
  }
  if (!matched) return 0;
  return total;
}

/** 机箱/散热器支持的板型列表 */
function formFactorList(value: string): ("E-ATX" | "ATX" | "mATX" | "ITX")[] | undefined {
  const s = squash(value).toUpperCase().replace(/-/g, "");
  const out = new Set<"E-ATX" | "ATX" | "mATX" | "ITX">();
  if (s.includes("EATX")) out.add("E-ATX");
  if (/(?<![ME])ATX/.test(s)) out.add("ATX");
  if (s.includes("MATX") || s.includes("MICROATX")) out.add("mATX");
  if (s.includes("ITX") || s.includes("MINIITX")) out.add("ITX");
  return out.size > 0 ? [...out] : undefined;
}

/**
 * 散热器支持的插槽列表。
 *
 * 官网常写 "LGA 1700 / 1851" —— 第二个数字不带 LGA 前缀，靠继承上一个前缀识别。
 * 漏掉一个插槽号看着无害，但会让"支持插槽"少一半还查不出来。
 */
function socketList(value: string): string[] | undefined {
  const out = new Set<string>();
  let lgaContext = false;
  for (const raw of value.split(/[\/,、|]|或|和/)) {
    const token = raw.replace(/[（(].*?[)）]/g, "").trim();
    if (token === "") continue;
    const lga = /LGA\s?(\d{4,5})/i.exec(token);
    if (lga) {
      out.add(`LGA${lga[1]}`);
      lgaContext = true;
      continue;
    }
    if (lgaContext) {
      // 承接上一段的 LGA 前缀："LGA 1700 / 1851" 里的 1851
      const continuation = /^(\d{4,5})/.exec(token);
      if (continuation) {
        out.add(`LGA${continuation[1]}`);
        continue;
      }
    }
    const am = /\bAM[345]\b/i.exec(token);
    if (am) out.add(am[0].toUpperCase());
  }
  return out.size > 0 ? [...out] : undefined;
}

/** 内存条数："2 x 16GB" → 2；"单条 16GB" → 1 */
function stickCount(value: string): number | undefined {
  const s = squash(value);
  const mult = s.match(/(\d+)\s*[x×*]\s*\d+/);
  if (mult) return Number(mult[1]);
  const kit = s.match(/kitof(\d+)/i);
  if (kit) return Number(kit[1]);
  const four = s.match(/\((\d+)\s*[x×*]\s*\d+\s*(?:gb|mb)\)/i);
  if (four) return Number(four[1]);
  return firstInt(s);
}

const RULES: Record<BuildItemCategory, FieldRule[]> = {
  cpu: [
    { field: "socket", labels: /^(CPU\s*)?(插槽|socket)/i, extract: (v) => normalizeSocket(v) },
    { field: "tdpWatts", labels: /(TDP|功耗|功率|最大功耗)/i, extract: (v) => firstInt(v) },
  ],
  motherboard: [
    { field: "socket", labels: /(CPU\s*插槽|处理器插槽|插槽类型|^socket)/i, extract: (v) => normalizeSocket(v) },
    {
      // 标签既可能写"内存类型/DDR4 内存"，也可能直接以 DDR 代次开头，两种都要覆盖
      field: "ramType",
      labels: /^(DDR[45])|(内存类型|支持的内存|内存频率|内存规格|内存\D{0,6}DDR)/i,
      extract: (v) => (/(DDR\s*5)/i.test(v) ? "DDR5" : /(DDR\s*4)/i.test(v) ? "DDR4" : undefined),
      preferLast: true,
    },
    {
      field: "formFactor",
      labels: /(板型|主板规格|外形尺寸|规格|form\s*factor)/i,
      extract: (v) => normalizeFormFactor(v),
      preferLast: true,
    },
    { field: "ramSlots", labels: /(内存插槽|内存槽位|DIMM\s*slot|内存\D{0,6}slot)/i, extract: (v) => count(v) },
    // 标签必须带"插槽/数量/slot"语义，否则会抓到 "M.2 3.2" 这类版本号
    { field: "m2Slots", labels: /M\.?2.{0,10}(插槽|数量|slot|支持|接口)/i, extract: (v) => count(v), preferLast: true },
    { field: "sataPorts", labels: /SATA.{0,10}(接口|数量|端口|port|支持)/i, extract: (v) => count(v), preferLast: true },
    {
      field: "pcieX16Slots",
      labels: /(PCI-?E|PCIe).{0,14}(插槽|数量|slot|x16|接口)/i,
      extract: (v) => count(v),
      preferLast: true,
    },
  ],
  gpu: [
    { field: "lengthMm", labels: /(显卡尺寸|尺寸|长度)/i, extract: (v) => lengthMm(v) },
    { field: "tdpWatts", labels: /(TDP|功耗|功率|推荐电源|最大功耗)/i, extract: (v) => firstInt(v) },
    {
      field: "pcie8pin",
      labels: /(供电接口|电源接口|外接供电|供电)/i,
      extract: (v) => powerConnectorCount(v, "8pin"),
      preferLast: true,
    },
    {
      field: "twelveVhpwr",
      labels: /(供电接口|电源接口|外接供电|供电)/i,
      extract: (v) => powerConnectorCount(v, "12v"),
      preferLast: true,
    },
  ],
  ram: [
    {
      field: "ddrType",
      labels: /(内存类型|规格|类型|DDR)/i,
      extract: (v) => (/(DDR\s*5)/i.test(v) ? "DDR5" : /(DDR\s*4)/i.test(v) ? "DDR4" : undefined),
    },
    { field: "sticks", labels: /(容量|规格|包装|组成)/i, extract: (v) => stickCount(v) },
  ],
  storage: [
    {
      field: "interface",
      labels: /(接口|规格|型式|类型)/i,
      extract: (v) => {
        const s = squash(v).toUpperCase();
        if (/(M\.?2|NVMe|PCIe)/i.test(s)) return "m2_nvme";
        if (/SATA/i.test(s)) return "sata";
        return undefined;
      },
    },
  ],
  psu: [
    { field: "ratedWatts", labels: /(额定功率|功率|瓦|规格|型号)/i, extract: (v) => firstInt(v), preferLast: true },
    {
      field: "pcie8pin",
      labels: /(CPU\s*供电|接口|线材|供电)/i,
      extract: (v) => powerConnectorCount(v, "8pin"),
      preferLast: true,
    },
    {
      field: "twelveVhpwr",
      labels: /(CPU\s*供电|接口|线材|供电)/i,
      extract: (v) => powerConnectorCount(v, "12v"),
      preferLast: true,
    },
  ],
  cooler: [
    {
      field: "supportedSockets",
      // 微星把插槽拆成 "Intel Socket" 与 "AMD Socket" 两行，必须合并，
      // 只取第一个会悄悄漏掉另一半插槽
      labels: /(支持.*插槽|插槽|兼容|socket|支持处理器|处理器支持)/i,
      extract: (v) => socketList(v),
      mergeArrays: true,
    },
    { field: "heightMm", labels: /(散热器高度|高度|散热高度|\bheight\b)/i, extract: (v) => lengthMm(v) },
  ],
  case: [
    {
      field: "supportedFormFactors",
      // 中文站与英文站标签不同（"主板规格支持" / "Motherboard Form Factor"），都要覆盖
      labels: /(支持.*主板|板型|兼容.*主板|主板规格|motherboard\s*form\s*factor|support.*motherboard)/i,
      extract: (v) => formFactorList(v),
    },
    {
      field: "maxGpuLengthMm",
      labels: /(显卡限长|显卡长度|支持.*显卡|限长|maximum\s*gpu\s*length|gpu\s*length)/i,
      extract: (v) => lengthMm(v),
    },
    {
      field: "maxCoolerHeightMm",
      labels: /(散热器限高|散热器高度|限高|cpu\s*散热器|maximum\s*cpu\s*cooler)/i,
      extract: (v) => lengthMm(v),
    },
  ],
};

function excerptAround(text: string, matchIndex: number, length: number): string {
  const start = Math.max(0, matchIndex - 60);
  const end = Math.min(text.length, matchIndex + length + 80);
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 600);
}

/**
 * 在原文里定位"标签 + 值"那一处。
 *
 * 同一个标签文字在页面上会出现两次（一次在左侧标签栏 `<ul>`，一次在值块里），
 * 直接取首次出现会截到标签列表的 HTML 片段，对人工复核毫无价值。
 * 这里挑**后面最近跟着该值**的那次出现。
 */
function locateExcerpt(rawHtml: string, label: string, value: string): string | null {
  const marker = label.replace(/\s+/g, "");
  const needle = value.replace(/\s+/g, "").slice(0, 24);
  let from = 0;
  let fallback = -1;
  for (let guard = 0; guard < 12; guard += 1) {
    const at = rawHtml.indexOf(marker, from);
    if (at < 0) break;
    if (fallback < 0) fallback = at;
    if (needle && rawHtml.slice(at, at + 600).replace(/\s+/g, "").includes(needle)) {
      return excerptAround(rawHtml, at, marker.length);
    }
    from = at + marker.length;
  }
  return fallback >= 0 ? excerptAround(rawHtml, fallback, marker.length) : null;
}

/**
 * 按类别解析规格页。
 *
 * @param text 页面可见文本（pairs 未提供时的兜底来源）
 * @param rawHtml 原始 HTML（用于在原文里定位摘录）
 * @param pairs 适配器按页面真实 DOM 结构提取的「标签/值」对。
 *   **强烈建议适配器自己提供**：靠文本邻近猜标签和值的对应关系会产生
 *   "pcieX16Slots: 16"（把 x16 当数量）这类看似合理、实则错误的值，
 *   而错误值一旦带上 S1 官方来源标记就会通过质量门去驱动兼容规则——比缺字段危险得多。
 */
export function parseSpecByCategory(
  category: BuildItemCategory,
  text: string,
  rawHtml: string,
  pairs?: LabeledValue[],
): { spec: SpecRecord; evidence: FieldEvidence[] } {
  const source = pairs && pairs.length > 0 ? pairs : labelValuePairs(text);
  const spec: Record<string, unknown> = {};
  const evidence: FieldEvidence[] = [];

  for (const rule of RULES[category]) {
    const candidates: { value: unknown; pair: LabeledValue }[] = [];
    for (const pair of source) {
      if (!rule.labels.test(pair.label)) continue;
      const value = rule.extract(pair.value, pair.label, source);
      if (value === undefined) continue;
      // 安全阀：越界即丢弃，字段留空——错值比缺字段危险
      if (!withinPlausible(rule.field, value)) continue;
      candidates.push({ value, pair });
    }
    if (candidates.length === 0) continue;
    const chosen = rule.preferLast ? candidates[candidates.length - 1]! : candidates[0]!;
    if (spec[rule.field] !== undefined) continue;

    let value: unknown = chosen.value;
    if (rule.mergeArrays && Array.isArray(chosen.value)) {
      // 合并所有命中标签的数组，去重后一起给出——漏一半比全错更隐蔽
      const merged: unknown[] = [];
      for (const candidate of candidates) {
        if (Array.isArray(candidate.value)) merged.push(...candidate.value);
      }
      if (merged.length > 0) value = [...new Set(merged)];
      // 合并后必须仍是合法值（至少一项），否则不写
      if (!Array.isArray(value) || value.length === 0) continue;
    }
    spec[rule.field] = value;

    // 摘录必须是"人看得懂"的原文：HTML 定位失败、或定位到的片段里根本没出现该值
    // （短数值如 "2" 在 HTML 里到处是），就退回「标签: 值」——那本身就是页面原文。
    const pairText = `${chosen.pair.label}: ${chosen.pair.value}`.replace(/\s+/g, " ").slice(0, 600);
    const located = locateExcerpt(rawHtml, chosen.pair.label, chosen.pair.value);
    const excerpt =
      located && located.replace(/\s+/g, "").includes(chosen.pair.value.replace(/\s+/g, "").slice(0, 12))
        ? located
        : pairText;
    evidence.push({ fieldPath: `spec.${rule.field}`, value: chosen.value, excerpt });
  }

  // 加载即校验：坏值在这里炸出来，不流向规则引擎
  const validated = specSchemaByCategory[category].parse(spec) as SpecRecord;
  return { spec: validated, evidence };
}
