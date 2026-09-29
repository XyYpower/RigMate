import {
  addReviewEvidence,
  addReviewSource,
  publishProduct,
} from "../src/application/catalog-review/service";
import { createHash } from "node:crypto";

/**
 * 第三批数据查证（Task 7 延续：电源接口批次，ZOL 参数页路线）。
 *
 * 来源口径：ZOL 参数页（业务规格 §11.3 允许的参数媒体离线导入，S3、署名+时间）。
 * 只录接口表逐项确认的数值；ZOL 未收录（无界PRO）、数量不全（VTE X2）、
 * 型号身份存疑（技嘉 P750GS/P650GS）、官网证书过期（机械大师 FX850）的一律不录，留在队列。
 * 注意：部分连接器数据（只有 twelveVhpwr=0 而 pcie8pin 缺）会造成规则引擎按 0 比较误阻断，
 * 所以宁可整组字段一起等齐证据再录。
 */

const REVIEWER = "ai:websearch-batch-2026-09-29";

type Entry = {
  productId: string;
  productName: string;
  evidence: Array<{ field: string; value: unknown; excerpt: string }>;
};

const BATCH: Entry[] = [
  {
    productId: "m-d97e1fe2-f788-4b20-994a-4c030be70266",
    productName: "航嘉 MVP K850 850W 金牌全模 ATX3.1",
    evidence: [
      { field: "pcie8pin", value: 4, excerpt: "ZOL 参数表：显卡接口（8Pin）4 个" },
      { field: "twelveVhpwr", value: 1, excerpt: "ZOL 参数表：12VHPWR 16pin 接口 1 个（ATX 3.1 版）" },
    ],
  },
  {
    productId: "m-9fecc8af-4d85-4575-80ee-bc23a9eed4b5",
    productName: "航嘉 WD750Evo 炫金战神 750W 金牌 ATX3.1",
    evidence: [
      { field: "pcie8pin", value: 2, excerpt: "ZOL 参数表（皓月白）：显卡接口（8Pin）2 个" },
      { field: "twelveVhpwr", value: 1, excerpt: "ZOL 参数表（皓月白）：12VHPWR 16pin 接口 1 个" },
    ],
  },
];

const ZOL_NOTE = "来源：ZOL 报价参数页（detail.zol.com.cn，2026-09-29 检索，搜索摘要逐字引用接口表行）";

let evidenceCreated = 0;
for (const entry of BATCH) {
  const source = addReviewSource({
    canonicalProductId: entry.productId,
    sourceType: "parameter_media",
    tier: "S3",
    sourceUrl: "https://detail.zol.com.cn/power/",
    sourceTitle: `ZOL 参数页：${entry.productName}（${ZOL_NOTE}）`,
    contentHash: createHash("sha256").update(entry.evidence.map((item) => item.excerpt).join("|")).digest("hex"),
    reviewer: REVIEWER,
  });
  for (const item of entry.evidence) {
    addReviewEvidence({
      canonicalProductId: entry.productId,
      fieldPath: `spec.${item.field}`,
      sourceId: source.id,
      value: item.value,
      excerpt: item.excerpt,
      identityMatch: "fields_matched",
      confidence: "medium",
      reviewer: REVIEWER,
    });
    evidenceCreated += 1;
  }
  const report = publishProduct({
    canonicalProductId: entry.productId,
    reviewer: REVIEWER,
    note: "批次三（ZOL 接口表）发布，待人工复核升 verified",
  });
  const adopted = Object.entries(report.fields)
    .filter(([, result]) => result.status === "verified" || result.status === "supported")
    .map(([field, result]) => `${field}=${String(result.value)}`);
  console.log(`${entry.productName} → ${report.productStatus} · ${adopted.join(", ")}`);
}

console.log(`批次三完成：证据 ${evidenceCreated} 条（ZOL 参数页，S3）。未录入：无界PRO×2（ZOL 未收录）、VTE X2（750W 版 8pin 数未确认）、FX850（官网证书过期）、技嘉 P750GS/P650GS（型号身份存疑）——均保留队列。`);
