import { createHash } from "node:crypto";
import type { BuildItemCategory } from "@/domain/build/types";
import {
  jsonLdProducts,
  productNameOf,
  visibleText,
  type DiscoveredProduct,
  type LabeledValue,
  type ParsedProductResult,
  type VendorAdapter,
} from "./contract";
import { parseSpecByCategory } from "./spec-parsers";

/**
 * 微星中国大陆官网（msi.cn）适配器。
 *
 * 为什么先做微星：
 * - **中国站 = 中文产品名 + 大陆在售 SKU**，正是自建目录最缺的那部分
 *   （BuildCores 是美国零售数据集，没有任何大陆 SKU）；
 * - robots.txt 明确 `Allow: /`，并自带 sitemap.xml，属于官方允许的采集路径；
 * - 产品 sitemap 覆盖显卡/主板/存储/电源/机箱/散热六类，一条线能补齐一半品类；
 * - 规格页是服务端渲染的「标签/值」结构，能被共享解析器稳定读取。
 *
 * 微星不生产 CPU 与内存，categories 如实不声明这两类——覆盖不到就不假装覆盖。
 */

export const MSI_ADAPTER_VERSION = "msi-cn-spec-v1";
const SITEMAP_INDEX = "https://www.msi.cn/sitemap.xml";
const PRODUCT_URL_PREFIX = "https://www.msi.cn";

/** sitemap 的一级路径 → RigMate 类别。覆盖全部已发现路径，
 *  供 --category 显式指定时使用；自动跑哪些类别由 categories 决定。 */
const CATEGORY_PATHS: Record<Exclude<BuildItemCategory, "cpu" | "ram">, string[]> = {
  motherboard: ["/Motherboard/"],
  gpu: ["/Graphics-Card/"],
  storage: ["/Storage/"],
  psu: ["/Power-Supply/"],
  case: ["/PC-Case/"],
  cooler: ["/Liquid-Cooling/", "/Air-Cooling/"],
};

function categoryOfPath(pathname: string): BuildItemCategory | null {
  for (const [category, prefixes] of Object.entries(CATEGORY_PATHS) as [
    Exclude<BuildItemCategory, "cpu" | "ram">,
    string[],
  ][]) {
    if (prefixes.some((prefix) => pathname.startsWith(prefix))) return category;
  }
  return null;
}

/**
 * 抓取间隔与重试：官方站点友好。
 * 实测 600ms 会被限流（连续抓取出现大量超时），放大到 1.2s 并退避重试。
 */
const REQUEST_GAP_MS = 1200;
const MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 采集公开产品页；声明 UA 便于厂商侧识别与限流
        "user-agent": "RigMateCatalogBot/1.0 (+https://github.com/XyYpower/RigMate)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9",
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试与请求间隔的抓取；连续失败返回 null，由调用方记入跳过报告 */
async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const html = await fetchOnce(url, timeoutMs);
    if (html !== null) return html;
    // 退避后再试：官网偶发超时/限流是常态，不该直接判死
    await sleep(REQUEST_GAP_MS * attempt);
  }
  return null;
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1]!.trim())
    .filter(Boolean);
}

/** 产品 id：URL slug 保证稳定且可回溯到官网 */
function productId(pathname: string): string {
  const slug = pathname.replace(/^\/+/, "").replace(/\/+$/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `cn-msi-${slug}`;
}

/**
 * 规格页的「标签 / 值」按真实 DOM 结构提取。
 *
 * msi.cn 用两栏并行列表：左侧 `ul#itembox > li` 是标签，右侧 `#pdtb .tr[data-num]`
 * 是同序的值块。两边都带 data-num/顺序号，**按索引配对**才可靠——
 * 靠文本邻近匹配会把 "PCI-E X16" 的 16 当成插槽数量，写出看似合理实则错误的值。
 */
export function msiSpecPairs(html: string): LabeledValue[] {
  const labelsBlock = /<ul[^>]*id=["']itembox["'][^>]*>([\s\S]*?)<\/ul>/i.exec(html);
  if (!labelsBlock) return [];
  const labels = [...labelsBlock[1]!.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => cleanCell(match[1]!))
    .filter((value) => value !== "");

  const valuesBlock = /<div[^>]*id=["']pdtb["'][^>]*>([\s\S]*?)<div[^>]*id=["']pdtabox["']/i.exec(html);
  const scope = valuesBlock?.[1] ?? html;
  const rows = [...scope.matchAll(/<div[^>]*class=["'][^"']*\btr\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class=["'][^"']*\btr\b|<\/div>\s*<\/div>)/gi)];

  const values: string[] = [];
  for (const row of rows) {
    // 值块里有一个只在窄屏显示的 specName 标签，取值前先剥掉
    const withoutLabel = row[1]!.replace(/<li[^>]*class=["'][^"']*specName[^"']*["'][^>]*>[\s\S]*?<\/li>/gi, " ");
    const value = cleanCell(withoutLabel);
    if (value !== "") values.push(value);
  }

  const pairs: LabeledValue[] = [];
  for (let index = 0; index < Math.min(labels.length, values.length); index += 1) {
    pairs.push({ label: labels[index]!, value: values[index]! });
  }
  return pairs;
}

function cleanCell(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export const msiAdapter: VendorAdapter = {
  vendor: "MSI",
  site: "msi.cn（中国大陆官网）",
  /**
   * 只声明**已对着真实页面核验过**的类别：主板、机箱。
   *
   * 其余类别的阻塞原因是官网**根本不提供该字段**，不是解析器不行（实测结论）：
   * - **显卡**：MSI 中国站规格页没有 TDP / 功耗 / Board Power，只有"建议电源 (W)"，
   *   那是推荐电源功率而非显卡自身功耗。拿它填 tdpWatts 就是编造，会直接污染
   *   兼容性规则（供电余量按 TDP 算）。→ GPU 无法从这里进质量门。
   * - **电源**：规格页里连 8pin / 12VHPWR / 线材 / 额定功率都没有，无法算供电接口。
   * - **散热器**：插槽能拿到（已合并 Intel/AMD 两行），但该系列页面没有"散热器高度"，
   *   heightMm 缺失；不同系列标签不同，需逐个系列核验后再放开。
   * - **存储**：规格页结构与主板不同（无 itembox 双栏），接口字段要从另一套结构里取。
   *
   * 宁可少覆盖一类，也不产出"看着合理实则错误"的字段：那种值会带着 S1 厂商来源
   * 标记通过质量门去驱动兼容规则，比缺字段危险得多。
   */
  categories: ["motherboard", "case"],

  async discover(category: BuildItemCategory, options = {}): Promise<string[]> {
    if (category === "cpu" || category === "ram") return [];
    const indexXml = await fetchText(SITEMAP_INDEX, 30_000);
    if (!indexXml) return [];

    const sitemapUrls = extractLocs(indexXml).filter((loc) => /sitemap-products-/i.test(loc));
    const urls = new Set<string>();

    for (const sitemapUrl of sitemapUrls) {
      const xml = await fetchText(sitemapUrl, 30_000);
      if (!xml) continue;
      for (const loc of extractLocs(xml)) {
        let pathname: string;
        try {
          pathname = new URL(loc).pathname;
        } catch {
          continue;
        }
        if (categoryOfPath(pathname) !== category) continue;
        // 规格表只挂在 /Specification 子页上；Overview 页只有营销文案，
        // 直接定位到规格页，避免抓回来一堆没有决策字段的页面。
        if (/\/(Overview|Review|Compare|Where-to-Buy)\/?$/i.test(pathname)) continue;
        urls.add(`${PRODUCT_URL_PREFIX}${pathname.replace(/\/$/, "")}/Specification`);
      }
      if (options.limit && urls.size >= options.limit) break;
    }

    const sorted = [...urls].sort();
    return options.limit ? sorted.slice(0, options.limit) : sorted;
  },

  fetchPage(url: string, options = {}): Promise<string | null> {
    return fetchText(url, options.timeoutMs ?? 30_000);
  },

  parse(url: string, category: BuildItemCategory, html: string): ParsedProductResult {
    const structured = jsonLdProducts(html)[0];
    const text = visibleText(html);

    let pathname = "";
    try {
      pathname = new URL(url).pathname;
    } catch {
      return { product: null, skipReason: "URL 无法解析" };
    }

    // 身份：官网产品名。微星不公布独立 MPN，型号名本身即唯一标识，
    // 因此 mpn 留空，由"厂商 + 型号"字段一致的身份判定接管（见 quality.ts identityMatchOf）。
    // 主板页没有 JSON-LD，靠 productNameOf 兜到 <title>。
    const name = productNameOf(html, pathname.split("/").filter(Boolean).pop());
    if (!name) return { product: null, skipReason: "页面未提供可确定的产品名" };

    // 按 msi.cn 的双栏 DOM 结构配对标签与值；拿不到结构时退回文本启发式
    const pairs = msiSpecPairs(html);
    const { spec, evidence } = parseSpecByCategory(category, text, html, pairs);

    const product: DiscoveredProduct = {
      id: productId(pathname),
      category,
      name,
      // msi.cn 是中国站，产品名多为英文；官网名本身含中文时即为官方中文名
      nameZh: /[\u3400-\u9fff]/.test(name) ? name : null,
      mpn: structured?.sku?.trim() || null,
      manufacturer: "MSI",
      aliases: [],
      refUrl: `${PRODUCT_URL_PREFIX}${pathname}`,
      spec,
      ...(typeof structured?.price === "number" && structured.price > 0
        ? { priceCny: structured.price }
        : {}),
      evidence,
      sourceVersion: MSI_ADAPTER_VERSION,
      contentHash: createHash("sha256").update(html, "utf8").digest("hex"),
      sourceTitle: name,
    };

    return { product };
  },
};
