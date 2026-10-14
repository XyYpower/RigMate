import { discoverAsusProductLinks, parseAsusProductPage, type AsusProductResult } from "./asus";

export type SyncRejectedItem = { url: string; reason: string };

export type AsusSyncResult = {
  indexUrl: string;
  discovered: number;
  products: AsusProductResult[];
  rejected: SyncRejectedItem[];
};

async function fetchPage(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { "user-agent": "RigMate-CN-Catalog/0.1" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function syncAsusMotherboards(input: {
  indexUrl: string;
  limit?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<AsusSyncResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 20_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error("timeoutMs 必须是 100 到 120000 之间的整数");
  }
  const indexResponse = await fetchPage(fetchImpl, input.indexUrl, timeoutMs);
  if (!indexResponse.ok) throw new Error(`索引页请求失败：HTTP ${indexResponse.status}`);
  const indexHtml = await indexResponse.text();
  const discoveredLinks = discoverAsusProductLinks(indexHtml);
  const urls = discoveredLinks.slice(0, Math.max(0, input.limit ?? discoveredLinks.length)).map((url) =>
    url.endsWith("/spec/") ? url : `${url.replace(/\/$/, "")}/spec/`,
  );
  const products: AsusProductResult[] = [];
  const rejected: SyncRejectedItem[] = [];
  for (const url of urls) {
    try {
      const response = await fetchPage(fetchImpl, url, timeoutMs);
      if (!response.ok) {
        rejected.push({ url, reason: `HTTP ${response.status}` });
        continue;
      }
      products.push(parseAsusProductPage(url, await response.text()));
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : String(error);
      rejected.push({ url, reason });
    }
  }
  return { indexUrl: input.indexUrl, discovered: discoveredLinks.length, products, rejected };
}
