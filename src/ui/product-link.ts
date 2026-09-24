/**
 * 商品页链接（M29 纪律）：库里有核验过的 refUrl 就用它；
 * 否则按型号拼京东搜索链接兜底——搜索链接永远指向当前在售商品，不做任何抓取。
 */
export function productPageUrl(name: string, refUrl?: string | null): string {
  if (refUrl && /^https?:\/\//i.test(refUrl.trim())) return refUrl.trim();
  return `https://search.jd.com/Search?keyword=${encodeURIComponent(name)}&enc=utf-8`;
}
