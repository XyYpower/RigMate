import type { BuildItemCategory } from "@/domain/build/types";
import type { SpecRecord } from "@/domain/build/specs";

/**
 * 中国大陆厂商官网适配器契约。
 *
 * 为什么要有这层抽象：每家官网的页面结构都不一样，但**规格字段的中文说法高度一致**
 * （"内存插槽""M.2""SATA 6Gb/s""显卡尺寸"…）。把「发现 URL / 提取身份 / 映射字段」
 * 三件事拆开之后，新增一个品牌只需要写它自己那三件事，字段映射复用同一套表——
 * 这正是"数据来源碎片化"能被收敛掉的地方。
 *
 * 纪律（与 src/infra/catalog-import/cn/asus.ts 一致，不因新来源而放松）：
 * - 只解析页面上**明确写出**的字段，解析不到就留空，绝不用同系列推断；
 * - 每个填上的字段都要带原文摘录（excerpt），供字段级证据链复核；
 * - 必填字段填不全 → 自动来源也只能进 partial，不能进方案候选。
 */

/** 字段解析结果：值 + 支撑它的页面原文 */
export type FieldResult<V = unknown> = {
  value: V;
  excerpt: string;
};

export type FieldEvidence = {
  fieldPath: `spec.${string}`;
  value: unknown;
  excerpt: string;
};

export type ParsedSpec = {
  spec: SpecRecord;
  evidence: FieldEvidence[];
};

/** 适配器识别出来的一条产品（尚未落库） */
export type DiscoveredProduct = {
  /** 稳定 id，形如 "cn-<vendor>-<slug>" */
  id: string;
  category: BuildItemCategory;
  /** 官网产品名（可能是中文） */
  name: string;
  /** 中文展示名；官网名本身含中文时由框架自动填充，可为 null */
  nameZh: string | null;
  /** 厂商型号/MPN；官网不提供时为 null（改走厂商+型号字段一致的身份判定） */
  mpn: string | null;
  manufacturer: string;
  aliases: string[];
  refUrl: string;
  spec: SpecRecord;
  /** 厂商页面标价（元）；官网没有标价时为 undefined——绝不推断 */
  priceCny?: number;
  evidence: FieldEvidence[];
  sourceVersion: string;
  /** 页面内容哈希，用于检测来源变化 */
  contentHash: string;
  sourceTitle: string;
};

export type ProductPage = {
  url: string;
  /** 页面可见文本（已去脚本/样式/标签） */
  text: string;
  /** 页面原始 HTML（用于 JSON-LD 等结构化数据） */
  html: string;
  contentHash: string;
};

export type VendorAdapter = {
  /** 品牌标识，进入产品 id 与来源审计 */
  vendor: string;
  /** 官网域名，仅用于审计展示 */
  site: string;
  /**
   * 该品牌覆盖的类别。MSI 不产 CPU / 内存，必须如实声明——
   * 覆盖不到就留空数组，不要假装覆盖。
   */
  categories: BuildItemCategory[];
  /** 列出某类别的产品页 URL */
  discover(category: BuildItemCategory, options?: { limit?: number }): Promise<string[]>;
  /** 抓取产品页原始 HTML（适配器自带重试与限速，失败返回 null） */
  fetchPage(url: string, options?: { timeoutMs?: number }): Promise<string | null>;
  /** 解析单个产品页 */
  parse(url: string, category: BuildItemCategory, html: string): ParsedProductResult;
};

export type ParsedProductResult = {
  /** 页面不是产品页 / 无法确定身份时返回 null，交由调用方跳过并记账 */
  product: DiscoveredProduct | null;
  /** 跳过原因，写进同步报告 */
  skipReason?: string;
};

/** 解析出的页面结构化产品名（各站 JSON-LD 形状不一，这里只收需要的字段） */
export type StructuredProduct = {
  name?: string | null;
  sku?: string | null;
  brand?: string | null;
  price?: number | null;
};

/** 从页面里抠出 JSON-LD Product（多个站共用，形状差异在调用方归一） */
export function jsonLdProducts(html: string): StructuredProduct[] {
  const out: StructuredProduct[] = [];
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const script of scripts) {
    const body = script.replace(/^<[^>]*>/, "").replace(/<\/script>\s*$/i, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue; // 单个 JSON-LD 块损坏不影响页面上其它可用数据
    }
    for (const value of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
      if (!types.includes("Product")) continue;
      const brand = record.brand as { name?: unknown } | undefined;
      const offers = record.offers as Record<string, unknown> | undefined;
      const priceValue = Array.isArray(offers) ? undefined : offers?.price;
      out.push({
        name: typeof record.name === "string" ? record.name.trim() : null,
        sku: typeof record.sku === "string" ? record.sku.trim() : null,
        brand: typeof brand?.name === "string" ? brand.name.trim() : null,
        price: typeof priceValue === "string" || typeof priceValue === "number" ? Number(priceValue) : null,
      });
    }
  }
  return out;
}

/**
 * 产品名提取：JSON-LD → og:title → `<title>` → 页面标题元素 → URL slug，逐级兜底。
 *
 * 各家站点并不一致，而且**同一个站点的新旧页面也不一致**：
 * 微星老页面 `<title>Overview A520M PRO | 微星科技</title>`，
 * 新页面（JS 渲染站）`<title>` 与 `og:title` 都是空的，型号只在 `<h3>` 里。
 * 所以必须多级兜底，并且跳过前端模板占位符（{{productLine}} 之类）。
 */
export function productNameOf(html: string, fallbackSlug?: string): string {
  const structured = jsonLdProducts(html)[0]?.name?.trim();
  if (structured) return preferSpecificName(cleanProductName(structured), fallbackSlug);

  const candidates: (string | null | undefined)[] = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1],
    /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1],
    // 型号常在产品页的标题元素里；<h1> 与 <h3> 都要看
    ...[...html.matchAll(/<h[13][^>]*>([\s\S]*?)<\/h[13]>/gi)].map((match) => match[1]),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    // 去掉标签与前端模板占位符（{{xxx}} 是未渲染的模板变量，不是产品名）
    const raw = candidate.replace(/<[^>]+>/g, " ").replace(/\{\{[^}]*\}\}/g, " ");
    const cleaned = cleanProductName(raw);
    if (cleaned) return preferSpecificName(cleaned, fallbackSlug);
  }

  if (fallbackSlug) return cleanProductName(fallbackSlug.replace(/[-_]+/g, " "));
  return "";
}

const PAGE_NOISE_PREFIX = /^(overview|spec(ification)?|规格|详细规格|产品概览)\s*[:：\-–]?\s*/i;
const SITE_SUFFIX = /\s*\|\s*[^|]{1,40}$/;
/** 厂商在标题里挂的 SEO 尾巴："型号 | Gaming Motherboards｜Best ... ｜MSI" */
const SEO_TAIL = /\s*[|｜].*$/;

/**
 * 清洗页面标题里的非产品部分。
 *
 * 两个必须剥掉的东西：
 * - 前缀 "Overview" 之类的页面语气词；
 * - " | Gaming Motherboards｜Best Motherboard for AI PC｜MSI" 这类 SEO 尾巴——
 *   留着会让多个型号挤成一串营销文案，界面上完全没法看。
 */
export function cleanProductName(value: string): string {
  // 前端模板占位符（{{productLine}} 之类）不是产品名，任何入口都要挡掉
  let name = decodeHtml(value).replace(/\{\{[^}]*\}\}/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(SEO_TAIL, "").trim();
  // 反复剥前缀：有的页面是 "Overview - A520M PRO"
  for (let guard = 0; guard < 3; guard += 1) {
    const next = name.replace(PAGE_NOISE_PREFIX, "");
    if (next === name) break;
    name = next.trim();
  }
  name = name.replace(SITE_SUFFIX, "").trim();
  return name;
}

const normalizeTokens = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/**
 * 系列页与具体型号的取舍。
 *
 * 微星有 B460 / B550 / H410 这类**芯片组系列页**，页面标题只有系列名，
 * 多个不同型号共用一个 URL 路径 —— 照抄标题会让几十条产品都叫 "B550"。
 *
 * 判据：URL slug 是型号级标识。若 slug 的信息量严格多于页面名，
 * 且页面名的每个词都出现在 slug 里，说明页面名是系列名而非型号名 → 用 slug。
 */
export function preferSpecificName(name: string, slug?: string): string {
  if (!slug) return name;
  const slugClean = cleanProductName(slug.replace(/[-_]+/g, " "));
  if (!slugClean) return name;
  const slugKey = normalizeTokens(slugClean).join("");
  const nameKey = normalizeTokens(name).join("");
  if (nameKey === "" || slugKey === "") return name || slugClean;
  // slug 是型号级标识：若它信息量更多，且页面名是它的子串（B550 ⊂ MAG B550M BAZOOKA），
  // 说明页面名只是系列名/营销修饰，型号级身份以 slug 为准
  if (slugKey.length > nameKey.length && slugKey.includes(nameKey)) return slugClean;
  return name;
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&reg;/gi, "®")
    .replace(/&trade;/gi, "™")
    .replace(/&amp;/gi, "&");
}

/** 页面可见文本：去脚本/样式/标签/HTML 实体，保留人话供规格正则匹配 */
export function visibleText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim(),
  );
}

/**
 * 规格页普遍是「标签行 / 值行」交替的结构。
 * 把可见文本切成 (label, value) 对，规格映射就不用为每家站各写一遍正则。
 */
export type LabeledValue = { label: string; value: string };

export function labelValuePairs(text: string): LabeledValue[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const pairs: LabeledValue[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const label = lines[index]!;
    const value = lines[index + 1]!;
    // 标签行应当短且不含明显句读；值行是紧随其后的那一行
    if (label.length > 24) continue;
    if (/[，。；：]$/.test(label)) continue;
    pairs.push({ label, value });
  }
  return pairs;
}
