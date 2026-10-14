import { createHash } from "node:crypto";
import { motherboardSpecSchema } from "@/domain/build/specs";
import { containsChinese } from "@/domain/catalog/localization";
import type { CatalogEntry } from "@/domain/catalog/seed";
import type { DiscoveredProduct } from "./contract";

export type MainlandEvidence = {
  fieldPath: `spec.${string}`;
  value: unknown;
  excerpt: string;
};

export type AsusProductResult = CatalogEntry & {
  source: "manufacturer_cn";
  manufacturer: string;
  mpn: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceVersion: string;
  contentHash: string;
  priceCny?: number;
  evidence: MainlandEvidence[];
};

export const ASUS_ADAPTER_VERSION = "asus-rog-spec-v4";

type JsonLdProduct = {
  "@type"?: unknown;
  name?: unknown;
  sku?: unknown;
  brand?: { name?: unknown };
  offers?: { price?: unknown; url?: unknown };
};

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function visibleText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function jsonLdProducts(html: string): JsonLdProduct[] {
  const products: JsonLdProduct[] = [];
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const script of scripts) {
    const body = script.replace(/^<[\s\S]*?>/, "").replace(/<\/script>\s*$/i, "").trim();
    try {
      const parsed: unknown = JSON.parse(body);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (value && typeof value === "object" && (value as JsonLdProduct)["@type"] === "Product") {
          products.push(value as JsonLdProduct);
        }
      }
    } catch {
      // A malformed JSON-LD block does not make other visible product data unusable.
    }
  }
  return products;
}

function firstMatch(text: string, patterns: RegExp[]): { value: string; excerpt: string } | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match || !match[1]) continue;
    const start = Math.max(0, match.index - 60);
    const end = Math.min(text.length, match.index + match[0].length + 80);
    return { value: match[1], excerpt: text.slice(start, end).trim() };
  }
  return undefined;
}

function normalizeSocket(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function normalizeFormFactor(value: string): "E-ATX" | "ATX" | "mATX" | "ITX" | undefined {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  if (normalized === "EATX" || normalized === "E-ATX") return "E-ATX";
  if (normalized === "ATX") return "ATX";
  if (normalized === "MATX" || normalized === "MICROATX") return "mATX";
  if (normalized === "ITX" || normalized === "MINI-ITX") return "ITX";
  return undefined;
}

function addEvidence(evidence: MainlandEvidence[], field: `spec.${string}`, value: unknown, excerpt: string): void {
  evidence.push({ fieldPath: field, value, excerpt });
}

function parseMotherboardSpec(text: string): { spec: Record<string, unknown>; evidence: MainlandEvidence[] } {
  const spec: Record<string, unknown> = {};
  const evidence: MainlandEvidence[] = [];

  const socket = firstMatch(text, [/\b(AM[45]|LGA\s*\d{4,5})\s*(?:插槽|Socket)/i]);
  if (socket) {
    const value = normalizeSocket(socket.value);
    spec.socket = value;
    addEvidence(evidence, "spec.socket", value, socket.excerpt);
  }

  const ramType = firstMatch(text, [/\b(DDR[45])\b/i]);
  if (ramType) {
    const value = ramType.value.toUpperCase();
    spec.ramType = value;
    addEvidence(evidence, "spec.ramType", value, ramType.excerpt);
  }

  const ramSlots = firstMatch(text, [/(\d+)\s*[x×]\s*内存插槽/i, /(\d+)\s*[x×]\s*DIMM\s*slots?/i]);
  if (ramSlots) {
    const value = Number(ramSlots.value);
    spec.ramSlots = value;
    addEvidence(evidence, "spec.ramSlots", value, ramSlots.excerpt);
  }

  const m2 = firstMatch(text, [
    /(?:共)?支持\s*(\d+)\s*个?\s*M\.2\s*插槽/i,
    /(\d+)\s*个?\s*M\.2\s*插槽/i,
    /Supports?\s*(\d+)\s*[x×]\s*M\.2\s*slots?/i,
    /(\d+)\s*[x×]\s*M\.2\s*slots?/i,
  ]);
  if (m2) {
    const value = Number(m2.value);
    spec.m2Slots = value;
    addEvidence(evidence, "spec.m2Slots", value, m2.excerpt);
  }

  const sata = firstMatch(text, [
    /(?:与|和)\s*(\d+)\s*个?\s*SATA[^。；\n]{0,35}接口/i,
    /(\d+)\s*SATA[^。；\n]{0,35}接口/i,
    /(\d+)\s*[x×]\s*SATA[^.!?]{0,25}?\bports?\b/i,
    /(\d+)\s*SATA[^.!?]{0,25}?\bports?\b/i,
  ]);
  if (sata) {
    const value = Number(sata.value);
    spec.sataPorts = value;
    addEvidence(evidence, "spec.sataPorts", value, sata.excerpt);
  }

  const formFactor = firstMatch(text, [
    /(E-?ATX|Micro\s*-?ATX|mATX|Mini\s*-?ITX|ITX|ATX)\s*规格/i,
    /(E-?ATX|Micro\s*-?ATX|mATX|Mini\s*-?ITX|ITX|ATX)\s*Form\s*Factor/i,
  ]);
  if (formFactor) {
    const value = normalizeFormFactor(formFactor.value);
    if (value) {
      spec.formFactor = value;
      addEvidence(evidence, "spec.formFactor", value, formFactor.excerpt);
    }
  }

  // RigMate 的 pcieX16Slots 语义是“可供独显使用的电气 x16 槽位”。
  // 官网常把物理 x16、但仅接 x4/x1 电气通道的槽也写成 x16，需排除这类描述。
  const pcieMatches = [
    ...text.matchAll(/(\d+)\s*[x×]\s*PCIe[^。；\n]{0,60}?\bx16\b[^。；\n]{0,20}?插槽/gi),
    // ASUS 英文规格会在外层 mode 说明中嵌入 PCIEx16(G5)_1 这样的括号；
    // 允许一层嵌套，否则会在 x4/x8 结论前截断，误把低电气通道算成 x16。
    ...text.matchAll(/(\d+)\s*[x×]\s*PCIe(?:\s+\d+(?:\.\d+)?)?\s+x16\s+slots?(?:\s*\((?:[^()]|\([^()]*\))*\))?(?:\s+with\s+Q-Release(?:\s+Slim)?)?/gi),
    ...text.matchAll(/(\d+)\s*[x×]\s*PCIe[^。；\n]{0,60}?\bx16\b[^。；\n]{0,30}?槽/gi),
  ]
    .filter((match) => {
      const value = match[0];
      const supportsAt = value.search(/(?:支持|supports?)/i);
      const modeDescription = supportsAt >= 0 ? value.slice(supportsAt) : "";
      const supportsOnlyLowerElectricalMode =
        modeDescription.length > 0 &&
        !/\bx16\b/i.test(modeDescription) &&
        /\bx[48]\b/i.test(modeDescription);
      return !supportsOnlyLowerElectricalMode && !/\bx1\s*16\b/i.test(value);
    })
    .filter((match, index, all) => all.findIndex((candidate) => candidate[0] === match[0]) === index);
  const dedupedPcieMatches = [...(() => {
    const groups = new Map<string, typeof pcieMatches>();
    for (const match of pcieMatches) {
      const value = match[0];
      const signature = value
        .replace(/\bPCIe\s+\d+(?:\.\d+)?\s+x16\b/gi, "PCIe x16")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const group = groups.get(signature) ?? [];
      group.push(match);
      groups.set(signature, group);
    }
    const output: typeof pcieMatches = [];
    for (const group of groups.values()) {
      const versions = new Set(
        group
          .map((match) => /\bPCIe\s+(\d+(?:\.\d+)?)\s+x16\b/i.exec(match[0])?.[1])
          .filter((version): version is string => Boolean(version)),
      );
      const isCpuVariantOfOnePhysicalSlot =
        group.length > 1 &&
        versions.size > 1 &&
        group.every((match) => /Q-Release/i.test(match[0]) && !/\bsupports?\b/i.test(match[0]));
      if (isCpuVariantOfOnePhysicalSlot) output.push(group[0]);
      else output.push(...group);
    }
    return output;
  })()];
  if (dedupedPcieMatches.length > 0) {
    const value = dedupedPcieMatches.reduce((sum, match) => sum + Number(match[1]), 0);
    spec.pcieX16Slots = value;
    addEvidence(evidence, "spec.pcieX16Slots", value, dedupedPcieMatches.map((match) => match[0]).join("；"));
  }

  return { spec: motherboardSpecSchema.parse(spec), evidence };
}

function productIdentity(html: string): { name: string; mpn: string; manufacturer: string; priceCny?: number } {
  const product = jsonLdProducts(html)[0];
  const name = typeof product?.name === "string" ? product.name.trim() : "";
  const mpn = typeof product?.sku === "string" ? product.sku.trim() : "";
  if (!name || !mpn) throw new Error("无法确定产品身份：JSON-LD 缺少 name 或 sku");
  const manufacturer = typeof product.brand?.name === "string" && product.brand.name.trim() ? product.brand.name.trim() : "ASUS";
  const parsedPrice = Number(product.offers?.price);
  return { name, mpn, manufacturer, ...(Number.isFinite(parsedPrice) && parsedPrice > 0 ? { priceCny: parsedPrice } : {}) };
}

export function parseAsusProductPage(sourceUrl: string, html: string): AsusProductResult {
  const identity = productIdentity(html);
  const parsed = parseMotherboardSpec(visibleText(html));
  const spec = motherboardSpecSchema.parse(parsed.spec);
  const normalizedMpn = identity.mpn.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: `cn-asus-${normalizedMpn}`,
    category: "motherboard",
    name: identity.name,
    // rog.asus.com.cn 是华硕中国站，产品名自带官方中文系列名（如"吹雪""迷你吹雪"）。
    // 这是 nameZh 唯一可信的来源：官网没写的昵称一律不推断。
    nameZh: containsChinese(identity.name) ? identity.name : null,
    aliases: [identity.mpn],
    spec,
    refUrl: sourceUrl,
    source: "manufacturer_cn",
    manufacturer: identity.manufacturer,
    mpn: identity.mpn,
    sourceUrl,
    sourceTitle: identity.name,
    sourceVersion: ASUS_ADAPTER_VERSION,
    contentHash: createHash("sha256").update(html, "utf8").digest("hex"),
    ...(identity.priceCny !== undefined ? { priceCny: identity.priceCny } : {}),
    evidence: parsed.evidence,
  };
}

export function discoverAsusProductLinks(html: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeHtml(match[1]), "https://rog.asus.com.cn/");
      if (url.hostname !== "rog.asus.com.cn") continue;
      if (!/^\/motherboards\//i.test(url.pathname)) continue;
      if (/\/spec\/?$/i.test(url.pathname) || /\/support\/?$/i.test(url.pathname)) continue;
      url.search = "";
      url.hash = "";
      links.add(url.toString().replace(/\/$/, "/"));
    } catch {
      // Ignore malformed/relative links that are not product URLs.
    }
  }
  return [...links].sort();
}

/**
 * 旧华硕解析结果 → 统一落库通道的输入形态。
 *
 * asus.ts 早于多品牌框架，先只实现 AsusProductResult。这里做一次显式转换，
 * 让华硕与微星共用 importManufacturerCnProducts 的证据链与质量门逻辑，
 * 避免两套落库纪律各自漂移。
 */
export function toDiscoveredProduct(result: AsusProductResult): DiscoveredProduct {
  return {
    id: result.id,
    category: result.category,
    name: result.name,
    nameZh: result.nameZh ?? null,
    mpn: result.mpn || null,
    manufacturer: result.manufacturer,
    aliases: result.aliases,
    refUrl: result.refUrl ?? result.sourceUrl,
    spec: result.spec,
    ...(result.priceCny !== undefined ? { priceCny: result.priceCny } : {}),
    evidence: result.evidence,
    sourceVersion: result.sourceVersion,
    contentHash: result.contentHash,
    sourceTitle: result.sourceTitle,
  };
}
