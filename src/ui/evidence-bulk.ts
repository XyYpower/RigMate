import { buildItemCategorySchema, type BuildItemCategory } from "@/domain/build/types";

/**
 * 价格证据批量粘贴解析（人工采集通道）。
 *
 * 格式：每行一条「[类别词] 型号描述 …… 价格」。行首可选类别词（中英文均可，
 * 见 CATEGORY_ALIASES），行尾最后一个独立数字为价格（元，必须 > 0），
 * 其余部分为型号描述。解析失败单独报错，不影响其他行。
 */

export type BulkEvidenceLine =
  | { ok: true; category: BuildItemCategory; productName: string; priceYuan: number }
  | { ok: false; line: string; reason: string };

export const CATEGORY_ALIASES: Record<BuildItemCategory, string[]> = {
  cpu: ["cpu", "处理器"],
  motherboard: ["motherboard", "mb", "主板"],
  gpu: ["gpu", "显卡", "显卡"],
  ram: ["ram", "内存"],
  storage: ["storage", "ssd", "hdd", "硬盘", "固态", "存储"],
  psu: ["psu", "电源"],
  cooler: ["cooler", "散热器", "散热"],
  case: ["case", "机箱"],
};

function matchCategoryToken(token: string): BuildItemCategory | null {
  const normalized = token.toLowerCase().replace(/[：:，,]/g, "");
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES) as Array<[BuildItemCategory, string[]]>) {
    if (aliases.includes(normalized)) return category;
  }
  return null;
}

/** 解析多行粘贴文本；defaultCategory 用于行首未写类别的行 */
export function parseBulkEvidenceLines(
  text: string,
  defaultCategory: BuildItemCategory,
): BulkEvidenceLine[] {
  const results: BulkEvidenceLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    // 行首类别词可选；不认作词则用默认类别
    let category = defaultCategory;
    let nameTokens = tokens;
    const firstCategory = matchCategoryToken(tokens[0]!);
    if (firstCategory) {
      category = firstCategory;
      nameTokens = tokens.slice(1);
    }

    // 行尾最后一个纯数字 token 为价格（元）
    const lastToken = nameTokens[nameTokens.length - 1];
    const priceYuan = Number(lastToken?.replace(/[¥￥,，]/g, ""));
    if (nameTokens.length < 2 || !Number.isFinite(priceYuan) || priceYuan <= 0) {
      results.push({ ok: false, line, reason: "未找到行尾价格（最后一个字段需为大于 0 的数字）" });
      continue;
    }

    const productName = nameTokens.slice(0, -1).join(" ").trim();
    if (!productName) {
      results.push({ ok: false, line, reason: "缺少型号描述" });
      continue;
    }
    if (productName.length > 160) {
      results.push({ ok: false, line, reason: "型号描述超过 160 字符" });
      continue;
    }
    results.push({ ok: true, category, productName, priceYuan });
  }
  return results;
}

export { buildItemCategorySchema };
