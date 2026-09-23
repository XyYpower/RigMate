import type { BuildItemCategory } from "../build/types";

/**
 * 整机复核配置单解析器（M25，纯函数）。
 *
 * 输入：用户粘贴的自由文本（主播单/电商单/自购单）。
 * 输出：逐行的 { 类别, 型号名, 价格 }。原则：
 * - 类别靠关键词识别，识别不了 → category = null（不猜，交给用户在界面手动归类）；
 * - 价格只取"行尾纯数字"（可带 ¥ / 千分位 / 小数），名字里的 32G/750W/6000 一律不当价格；
 * - 赠品/服务/标题行标记 skipped，附原因；所有结果都经用户在界面上确认后才入清单。
 */

export type ParsedLine = {
  lineNumber: number;
  raw: string;
  /** null = 未识别类别（界面上让用户手动归类或忽略） */
  category: BuildItemCategory | null;
  name: string;
  priceCents: number | null;
  skipped: boolean;
  skipReason: string | null;
};

/** 类别关键词（行内任意位置），先匹配先得 */
const CATEGORY_RULES: { category: BuildItemCategory; pattern: RegExp }[] = [
  { category: "cpu", pattern: /\bCPU\b|处理器/i },
  { category: "motherboard", pattern: /主板/i },
  { category: "gpu", pattern: /显卡|显示卡/i },
  { category: "ram", pattern: /内存/i },
  { category: "storage", pattern: /固态|硬盘|SSD/i },
  { category: "psu", pattern: /电源/i },
  { category: "cooler", pattern: /散热|水冷|风冷|冷排/i },
  { category: "case", pattern: /机箱/i },
];

/** 硬跳过：这些词出现即整行跳过（优先于类别匹配）——赠品/服务/统计类行 */
const HARD_SKIP =
  /总价|利润|质保|包\s*邮|包\s*装|上门|运费|砍一刀|来源|已售|店铺|赠品|赠送|显示器|外设|键盘|鼠标|耳机|其他|备注/;

/** 行首类别标签（"CPU:" "散热 " "- 主板："），剥掉后剩下的就是型号名 */
const LEADING_LABEL =
  /^\s*[-•*]*\s*(CPU|主板|显卡|内存|固态|硬盘|SSD|电源|散热器|散热|机箱)\s*[:：]?\s*/i;

/** 名字里的型号 token（字母数字/连字符≥3位，不含点号），用于目录检索关键词 */
export function modelTokenOf(name: string): string {
  const tokens = name.match(/[A-Za-z0-9][A-Za-z0-9-]{2,}/g) ?? [];
  const meaningful = tokens.filter((t) => !/^\d+$/.test(t));
  if (meaningful.length === 0) return "";
  // 取最长的 token（通常是系列/型号名，如 14700KF / TP5000 / FV160）
  return meaningful.reduce((best, t) => (t.length > best.length ? t : best), "");
}

function parsePriceTail(name: string): { name: string; priceCents: number | null } {
  const trimmed = name.replace(/[起元]$/, "").trim();
  // 价格前必须有分隔符（空格/括号）：否则 "C36"/"MV360" 的尾数会被误当价格
  const match = trimmed.match(/^(.+?)[\s(（](¥?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)[）)]?$/);
  if (!match) return { name: trimmed, priceCents: null };
  const tail = match[2];
  // 带 ¥ 的一定是价格；纯数字（可带千分位）必须 2-6 位（防把型号里的数字当价格）
  const digits = tail.replace(/,/g, "").replace("¥", "");
  if (!tail.startsWith("¥") && !/^\d{2,6}(\.\d+)?$/.test(digits)) {
    return { name: trimmed, priceCents: null };
  }
  const yuan = Number(digits);
  if (!Number.isFinite(yuan) || yuan <= 0) return { name: trimmed, priceCents: null };
  return { name: match[1].trim(), priceCents: Math.round(yuan * 100) };
}

export function parseReviewText(text: string): ParsedLine[] {
  const result: ParsedLine[] = [];
  let lineNumber = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    lineNumber += 1;
    const raw = rawLine.trim();
    if (!raw || /^[-=—*_\s]+$/.test(raw)) continue; // 空行/分隔线不入结果

    if (HARD_SKIP.test(raw)) {
      result.push({
        lineNumber,
        raw,
        category: null,
        name: "",
        priceCents: null,
        skipped: true,
        skipReason: "赠品/服务/统计行，不属于八类配件",
      });
      continue;
    }

    const categoryRule = CATEGORY_RULES.find(({ pattern }) => pattern.test(raw));
    if (!categoryRule) {
      result.push({
        lineNumber,
        raw,
        category: null,
        name: "",
        priceCents: null,
        skipped: true,
        skipReason: "未识别类别，可手动归类或忽略",
      });
      continue;
    }

    const withoutLabel = raw.replace(LEADING_LABEL, "").replace(/^[-•*]\s*/, "").trim();
    const { name, priceCents } = parsePriceTail(withoutLabel);
    result.push({
      lineNumber,
      raw,
      category: categoryRule.category,
      name: name || raw,
      priceCents,
      skipped: false,
      skipReason: null,
    });
  }

  return result;
}
