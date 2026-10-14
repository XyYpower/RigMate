/**
 * 产品名本地化（面向中国大陆用户）
 *
 * 边界（与本项目"绝不猜事实"的红线一致）：
 * - **规格字段永不翻译**：AM5 / DDR5 / ATX / 650W 是标准值，翻译即制造错误；
 * - 只有"产品名"这一个展示字段做本地化，name 本身仍是身份与证据链的锚，不被改写；
 * - 中文厂商名只取中国大陆零售市场的通用叫法，来源是目录里真实存在的厂商前缀；
 * - 官方中文昵称（吹雪 / 猛禽 / 魔爪 …）只接受厂商中国官网原文里带的（nameZh），
 *   目录里没有就不推断——猜错一个昵称比留英文更伤可信度；
 * - 中文名缺失时回退英文原名，绝不留空白（诚实降级）。
 */

/** 中文展示名的来源，决定 UI 能否声称"官方中文名" */
export type DisplayNameBasis =
  /** 厂商中国官网原文带的中文名 */
  | "official_cn"
  /** 目录里本来就是中文名（人工种子目录） */
  | "already_zh"
  /** 英文原名 + 本地化厂商前缀 */
  | "vendor_zh"
  /** 没有可核实的中文名，原样显示 */
  | "en_only";

export type LocalizedName = {
  /** 界面上显示的文本 */
  display: string;
  /** 英文原名（title 悬停提示 / 溯源用） */
  original: string;
  basis: DisplayNameBasis;
};

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** 是否含中日韩表意文字（表意文字补充区不收，避免误判生僻字形） */
export function containsChinese(value: string): boolean {
  return CJK_PATTERN.test(value);
}

type VendorRule = {
  /** 英文厂商名（小写，用于前缀匹配） */
  en: string;
  /** 中国大陆通用中文名 */
  zh: string;
};

/**
 * 厂商中文名对照表。
 *
 * 收录标准：中文写法在大陆装机圈与零售渠道稳定通用，且只换厂商、不含型号语义
 * （系列昵称如"泰坦""猛禽"绝不凭印象套用）。
 * 未收录的品牌（NZXT、EVGA、PNY、XFX、Thermalright 之外的生僻厂商等）走英文原样回退。
 *
 * 证据：表内每条都能在目录实际厂商前缀中命中——见 tests/domain/catalog-localization.test.ts
 * 用真实目录名回归，避免收录表和目录脱节。
 */
export const VENDOR_NAME_ZH: readonly VendorRule[] = [
  { en: "western digital", zh: "西部数据" },
  { en: "fractal design", zh: "分形设计" },
  { en: "silicon power", zh: "广颖电通" },
  { en: "cooler master", zh: "酷冷至尊" },
  { en: "be quiet!", zh: "德商必酷" },
  { en: "g.skill", zh: "芝奇" },
  { en: "thermalright", zh: "利民" },
  { en: "thermaltake", zh: "泰坦克" },
  { en: "silverstone", zh: "银欣" },
  { en: "seasonic", zh: "海韵" },
  { en: "deepcool", zh: "九州风神" },
  { en: "noctua", zh: "猫头鹰" },
  { en: "phanteks", zh: "追风者" },
  { en: "jonsbo", zh: "乔思伯" },
  { en: "lian li", zh: "联力" },
  { en: "antec", zh: "安钛克" },
  { en: "cougar", zh: "骨伽" },
  { en: "corsair", zh: "海盗船" },
  { en: "gigabyte", zh: "技嘉" },
  { en: "sapphire", zh: "蓝宝石" },
  { en: "inno3d", zh: "映众" },
  { en: "gainward", zh: "铭瑄" },
  { en: "zotac", zh: "索泰" },
  { en: "asrock", zh: "华擎" },
  { en: "samsung", zh: "三星" },
  { en: "seagate", zh: "希捷" },
  { en: "crucial", zh: "英睿达" },
  { en: "lexar", zh: "雷克沙" },
  { en: "kingston", zh: "金士顿" },
  { en: "patriot", zh: "博帝" },
  { en: "adata", zh: "威刚" },
  { en: "enermax", zh: "安耐美" },
  { en: "toshiba", zh: "东芝" },
  { en: "asus", zh: "华硕" },
  { en: "msi", zh: "微星" },
  { en: "intel", zh: "英特尔" },
  { en: "nvidia", zh: "英伟达" },
  { en: "acer", zh: "宏碁" },
  { en: "fsp", zh: "全汉" },
  { en: "galax", zh: "影驰" },
];

/** 长前缀优先："western digital" 必须先于任何更短的前缀命中 */
const VENDOR_RULES_BY_LENGTH = [...VENDOR_NAME_ZH].sort((a, b) => b.en.length - a.en.length);

/**
 * 按首字母分桶：目录有两万多条，检索每条都要试规则。
 * 只看首字母相同的桶（英文厂商名首字母唯一），把每条的规则尝试从 ~44 次降到 1~3 次。
 */
const VENDOR_RULES_BY_FIRST_CHAR: ReadonlyMap<string, readonly VendorRule[]> = (() => {
  const buckets = new Map<string, VendorRule[]>();
  for (const rule of VENDOR_RULES_BY_LENGTH) {
    const key = rule.en.slice(0, 1);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(rule);
    else buckets.set(key, [rule]);
  }
  return buckets;
})();

function splitVendorPrefix(name: string): { zh: string; rest: string } | null {
  const lower = name.toLowerCase();
  for (const rule of VENDOR_RULES_BY_FIRST_CHAR.get(lower.slice(0, 1)) ?? []) {
    if (lower === rule.en || lower.startsWith(`${rule.en} `)) {
      return { zh: rule.zh, rest: name.slice(rule.en.length).trim() };
    }
  }
  return null;
}

/**
 * @param name 英文（或已是中文的）原名
 * @param nameZh 厂商中国官网原文带的中文名，可空
 * @param options.trim 是否截掉尾部规格参数，默认 true。
 *   调用方应在**检测到同类别显示名撞车后用 trim:false 重新解析**——
 *   可读性不能以"两款产品看起来一模一样"为代价。
 */
export function localizeProductName(
  name: string,
  nameZh?: string | null,
  options: { trim?: boolean } = {},
): LocalizedName {
  const trim = options.trim ?? true;
  const original = name.trim();

  // 1) 官网原文自带中文名：唯一可声称"官方中文名"的来源。
  //    中国大陆同步下来的条目里 name 本身就含中文（nameZh === name），
  //    此时展示名等于原名，basis 记 already_zh 而不是 official_cn——
  //    只有中文名与英文原名**不同**时，"官网中文名"才是有信息量的。
  if (nameZh?.trim()) {
    const zh = nameZh.trim();
    if (!containsChinese(zh)) {
      // 不含中文 = 没登记成中文名，拒绝采用
      return { display: original, original, basis: "en_only" };
    }
    return zh !== original
      ? { display: zh, original, basis: "official_cn" }
      : { display: original, original, basis: "already_zh" };
  }

  // 2) 目录里本来就是中文名（人工种子目录已按大陆习惯命名）
  if (containsChinese(original)) {
    return { display: original, original, basis: "already_zh" };
  }

  // 3) 英文原名 + 本地化厂商前缀 + 参数截断
  const vendor = splitVendorPrefix(original);
  // 未识别出厂商时整串都是"型号部分 + 首 token 疑似厂商"，守卫要把首 token 排除
  const modelPart = vendor ? vendor.rest : original;
  const model = trim
    ? stripSpecNoise(modelPart, vendor ? 0 : 1)
    : modelPart.trim();

  if (vendor) {
    return {
      display: model ? `${vendor.zh} ${model}` : vendor.zh,
      original,
      basis: "vendor_zh",
    };
  }

  // 4) 认不出的品牌：只做参数截断，仍不硬套中文（basis 保持 en_only——没有中文名来源）
  return { display: model || original, original, basis: "en_only" };
}

/** 参与本地化的最小输入面 */
export type NameInput = { category?: string; name: string; nameZh?: string | null };

export type ResolvedDisplay = {
  displayName: string;
  displayNameOriginal: string;
  displayNameBasis: DisplayNameBasis;
  /** 是否因为同类别撞车而放弃了参数截断（排查用） */
  displayNameUntrimmed: boolean;
};

/**
 * 列表级解析：先按可读性截断，再对**同类别内撞车**的条目回退到不截断。
 *
 * 为什么必须回退：BuildCores 里大量条目只在末尾参数上不同
 * （"…FURY Beast 6000MT/s 32GB" vs "…FURY Beast 6000MT/s 16GB"），
 * 一律截断会让界面上出现两行一模一样的名字，用户无从分辨。
 * 可读性不能以"分不清产品"为代价——所以撞车即放弃截断，而不是去猜该保留哪个参数。
 *
 * @param collisionKey 返回同类别内的分组键；默认用 category（缺省视为同一组）
 */
export function resolveDisplayNames<T extends NameInput>(
  items: readonly T[],
  collisionKey: (item: T) => string = (item) => item.category ?? "",
): (T & ResolvedDisplay)[] {
  const first = items.map((item) => {
    const localized = localizeProductName(item.name, item.nameZh);
    return { item, localized, displayNameUntrimmed: false };
  });

  const seen = new Map<string, number>();
  for (const row of first) {
    const key = `${collisionKey(row.item)} ${row.localized.display.toLowerCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  return first.map((row) => {
    const key = `${collisionKey(row.item)} ${row.localized.display.toLowerCase()}`;
    if ((seen.get(key) ?? 0) < 2) {
      return {
        ...row.item,
        displayName: row.localized.display,
        displayNameOriginal: row.localized.original,
        displayNameBasis: row.localized.basis,
        displayNameUntrimmed: false,
      };
    }
    const fallback = localizeProductName(row.item.name, row.item.nameZh, { trim: false });
    return {
      ...row.item,
      displayName: fallback.display,
      displayNameOriginal: fallback.original,
      displayNameBasis: fallback.basis,
      displayNameUntrimmed: true,
    };
  });
}

/**
 * BuildCores 的 name 是「营销名 + 参数堆叠」，而且参数**插在中间**不是只挂尾部：
 *   DeepCool AK400 ZERO DARK Performance CPU Cooler, 4 Copper Heat Pipes, …
 *   Thermaltake Toughpower GF A3 - TT Premium Edition ATX 850W Fully Modular 80+ Gold
 *
 * 所以这里做**截断**（遇到第一个规格 token 就停）而不是尾部剥离——截断点判错只会
 * 丢掉后缀；剥离判错会把型号中间挖空。完整英文原名始终在 title 悬停里，随时可逆。
 *
 * 只收「规格 token」，不收营销词：Edition / Premium / Plus / Pro / Ti / Tower / Gaming
 * 一律不动——SeaSonic FOCUS **Plus** Platinum、Thermaltake **Tower** 300 都是真型号名。
 */
const NOISE_TOKEN_PATTERNS: readonly RegExp[] = [
  // 数值 + 单位：750W / 32GB / 5600MT/s / 57.3 / 159mm / 7200RPM / 12GB
  /^\d+(\.\d+)?\s?(W|WH|V|A|GB|TB|MB|KB|MHz|GHz|MBps|GB\/s|MT\/s|MTps|CFM|RPM|mm|cm|inch|pin|PIN|L)$/i,
  // 容量组合：2x16GB / 4x32
  /^\d+\s*[x×]\s*\d+$/i,
  // 内存代次与接口：DDR5 / GDDR6 / DIMM / PCIe / SATA / NVMe / M.2 / USB
  /^(DDR[345]|GDDR\w{1,2}|SDRAM|EDIMM|UDIMM|SODIMM|DIMM|RAM|PCIe?(\s\d(\.\d)?)?|PCI-E|SATA|NVMe|M\.?2|USB|HDMI|DVI|DisplayPort)$/i,
  // 板型：ATX / mATX / Mini-ITX
  /^(ATX|mATX|E-?ATX|Mini-?ITX|ITX|Micro-?ATX)$/i,
  // 插槽：LGA1700 / AM5
  /^(LGA\s?\d{4,5}|AM[345])$/i,
  // 品类与包装词。
  // 刻意**不含** Fan / Gold / Platinum / Bronze / Titanium / Plus / Tower / Edition：
  // PNY "Dual Fan"、SK hynix "Platinum P41"、SeaSonic "FOCUS Plus"、Thermaltake "Tower 300"
  // 都是型号名的一部分，砍掉就等于把型号说错。
  /^(CPU|GPU|PSU|SSD|HDD|Computer|Case|Cooler|Heatsink|Motherboard|Module|Kit|Mini|Micro|Mid-?Tower|SFF|Compact|OEM|Tray|Channel|Internal|External|Desktop|Memory)$/i,
  /^(CPU|Air|Liquid|Water|Power|Graphics|Video|Solid|State|Gaming|Performance)\s+(Cooler|Cooling|Supply|Card|Memory|Drive)$/i,
  // 认证与模组化：80+ / Fully / Modular
  /^(80\+|Certified|Fully|Modular|Non-?Modular|Semi|Full)$/i,
];

/** 纯数字 token，只有后面紧跟单位 token 时才算规格（避免把 "Ryzen 7" 的 7 当噪音） */
const BARE_NUMBER = /^\d+(\.\d+)?$/;
const UNIT_FOLLOWER = /^(TB|GB|MB|W|V|L|inch|in|")/i;
/** 同样算"规格"的单位跟进词：57.3 CFM、1800 RPM、3.5 GHz 这类分写的数值 */
const UNIT_FOLLOWER_SPLIT = /^(CFM|RPM|GHz|MHz|W|Wh|mm|pin|PIN|inch|in|")/i;

/**
 * 短促的大写字母片段：型号代号常被功率/容量切开后的残留（N500 → N、GM500 → GM）。
 *
 * 上限取 **2** 而不是 3：3 会把 RGB 这类合法的变体后缀误判成断码。
 * 宁可少裁几次，也不能把 "Trident Z5 RGB" 说成 "Trident Z5"。
 */
const SHORT_ALLCAPS_FRAGMENT = /^[A-Z]{1,2}$/;

/**
 * 这次截断会不会把型号代号切断？
 *
 * 目录里大量型号把功率/容量直接拼在代号后面（LEPA **N500**、GameMax **GM500**），
 * 截断后就只剩 "LEPA N" 这种废名——比多显示几个参数糟糕得多。
 *
 * 判据要同时满足两条，缺一不可：
 * 1. 保留部分的末尾是**短促纯大写字母**（N / GM / ZS）；
 * 2. 保留的**型号信息本身已经所剩无几**（≤2 个 token，厂商名已剔除）。
 *
 * 第 2 条是关键：单看第 1 条会误伤合法变体后缀——
 * "MSI SPATIUM **M480 HS** 1TB SSD" 里的 HS 是型号的一部分，不是断码。
 * 型号段已经剩了 3 个 token（M480 有数字、有信息）时，截断是安全的。
 */
function wouldBreakModelCode(modelTokens: readonly string[]): boolean {
  if (modelTokens.length > 2) return false;
  const lastKept = modelTokens[modelTokens.length - 1];
  if (!lastKept) return false;
  return SHORT_ALLCAPS_FRAGMENT.test(tokenCore(lastKept));
}

/** 去掉 token 两侧的括号与标点，让 "（4x32GB）" / "(2x16GB)," 也能匹配 */
function tokenCore(token: string): string {
  return token.replace(/^[(\[<{"'“‘]+|[)\]>}.,;:!?'"”’]+$/g, "");
}

function isNoiseToken(token: string): boolean {
  const core = tokenCore(token);
  if (core === "") return false;
  return NOISE_TOKEN_PATTERNS.some((pattern) => pattern.test(core));
}

function isNoiseWithUnit(tokens: readonly string[], index: number): boolean {
  if (!BARE_NUMBER.test(tokenCore(tokens[index]!))) return false;
  const next = tokens[index + 1];
  if (next === undefined) return false;
  const core = next.replace(/^[(\[<{"'“‘]+/, "");
  return UNIT_FOLLOWER.test(core) || UNIT_FOLLOWER_SPLIT.test(core);
}

/**
 * 截掉第一个规格 token 及其之后的全部内容；找不到规格 token 就原样返回。
 *
 * @param name 已剔除厂商名的型号部分（未识别出厂商时传整串）
 * @param vendorTokenCount 开头有几个 token 属于厂商名（断码守卫只看型号部分）
 */
export function stripSpecNoise(name: string, vendorTokenCount = 0): string {
  const original = name.trim();
  const tokens = original.split(/\s+/);
  if (tokens.length < 3) return original;

  // 从第 1 个 token 起找（index 0 是厂商 token，必须保留）
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const isNoise = isNoiseToken(token) || isNoiseWithUnit(tokens, index);
    if (!isNoise) continue;
    const kept = tokens.slice(0, index);
    // 安全栏一：会把型号代号切断就别切（modelTokens 已剔除厂商 token）
    if (wouldBreakModelCode(kept.slice(vendorTokenCount))) return original;
    const cleaned = cleanTrailing(kept.join(" "));
    // 安全栏二：截断后至少要留下 2 个 token，否则说明判错了，整段保留
    if (cleaned.split(/\s+/).filter(Boolean).length < 2) return original;
    return cleaned;
  }
  return original;
}

/** 清掉截断留下的悬空分隔符："NZXT H210i -" → "NZXT H210i" */
function cleanTrailing(value: string): string {
  return value.replace(/[\s,;|/&+\-–—:·]+$/g, "").trim();
}

type NameBearing = { name: string; nameZh?: string | null };

/** 目录条目版：优先使用条目上的 nameZh（数据），否则按原名推导 */
export function localizeCatalogEntry(entry: NameBearing): LocalizedName {
  return localizeProductName(entry.name, entry.nameZh);
}
