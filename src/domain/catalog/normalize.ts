/**
 * 型号文本规范化（launch-readiness §6.1 召回顺序第一步 / blueprint M2）。
 *
 * 目标：同一型号在不同写法下规范化结果一致——大小写、全角、空格/连字符/点、
 * 括号注记（如「AMD RX 7600（参考规格）」的真实目录脏尾巴）。
 * 中文保留原文参与比较（中文名命中的基础）。
 */

/** 全角（FF01–FF5E）转半角；全角空格转半角空格 */
function toHalfWidth(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 0x3000) out += " ";
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else out += char;
  }
  return out;
}

/** 剥离全/半角括号注记（目录导入的「（参考规格）」「(8 核 16 线程)」等说明尾巴） */
function stripAnnotations(text: string): string {
  return text
    .replace(/（[^（）]*）/g, " ")
    .replace(/\([^()]*\)/g, " ");
}

export function normalizeModelText(text: string): string {
  return stripAnnotations(toHalfWidth(text).toLowerCase())
    .replace(/[\s\-_.+/\\|,]/g, "")
    .trim();
}

/** 抽取字母数字 token（中文当分隔符）：别名 token 命中用 */
export function modelTokens(text: string): string[] {
  const normalized = toHalfWidth(text).toLowerCase();
  const matches = normalized.match(/[a-z0-9]+/g) ?? [];
  return [...new Set(matches)];
}

/**
 * 从用户语句抽取「型号短语」：抽取字母数字连续段（run）——段内允许空格/连字符/点
 * 连接（"R7 9800X3D""4070 SUPER"），中文字符天然成为 run 边界。
 * 必须同时含字母和数字（纯数字预算、纯 "cpu" 不是型号）；抽不出来就不激活，绝不硬凑。
 */
export function modelPhrases(text: string): string[] {
  const normalized = toHalfWidth(text).toLowerCase();
  const runs = normalized.match(/[a-z0-9]+(?:[\-_. ][a-z0-9]+)*/g) ?? [];
  return [
    ...new Set(
      runs
        .map((run) => run.trim())
        .filter((run) => run.length > 0 && /[a-z]/.test(run) && /[0-9]/.test(run)),
    ),
  ];
}

/**
 * 型号变体词表（M3）：alias 命中点之后紧跟这些 token = 用户点名的是**另一个变体**
 * （"5090 Ti"≠"5090"、"4070 SUPER"≠"4070"）。规格后缀（32G）与错字尾部不在词表，
 * 不影响正常命中——这是词表法与"一刀切尾部守卫"的差异所在。
 */
export const MODEL_VARIANT_TOKENS: ReadonlySet<string> = new Set([
  "ti",
  "super",
  "xt",
  "xtx",
  "ks",
  "kf",
  "pro",
  "max",
  "ultra",
]);

/** alias 包含命中后，检查命中点尾部的首个字母 token 是否为变体词（是 = 拒绝该命中） */
export function aliasMatchBlockedByVariantTail(aliasNorm: string, phraseNorm: string): boolean {
  const index = phraseNorm.indexOf(aliasNorm);
  if (index < 0) return false;
  const tail = phraseNorm.slice(index + aliasNorm.length);
  const nextWord = tail.match(/^[a-z]+/);
  return nextWord !== null && MODEL_VARIANT_TOKENS.has(nextWord[0]);
}
