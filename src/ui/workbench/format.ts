/** 等宽数字格式化：分 → ¥xx,xxx（价格/时间等数据展示统一走这里） */
export function formatYuanParts(cents: number): string {
  return `¥${Math.round(cents / 100).toLocaleString("zh-CN")}`;
}

export function formatYuanRange(lowCents: number | null, highCents: number | null): string {
  if (lowCents === null || highCents === null) return "价格待确认";
  return `${formatYuanParts(lowCents)} – ${formatYuanParts(highCents)}`;
}
