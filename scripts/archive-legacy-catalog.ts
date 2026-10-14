import { closeDatabase } from "../src/infra/db/client";
import { loadCatalogEntries, setCatalogQualityStatus } from "../src/infra/db/repositories/catalog-repository";
import { appendQualityEvent } from "../src/infra/db/repositories/quality-repository";

/**
 * 旧目录来源降级归档（hw-agent 精选库接管候选池）。
 *
 * 把 buildcores / zol 来源的条目 quality_status → partial：
 * partial 不过质量门（verified/supported 才能进候选），数据本身**不删除**，
 * 随时可手动恢复。每条留 deprecated 质量事件（before/after 快照）。
 *
 * 默认 dry-run；--write 才落库。manual / hwagent / manufacturer_cn 之外的 seed 也归档。
 * 注意：fixture 流程（E2E/单测）自行种库且不跑本脚本，不受影响。
 */

const ARCHIVED_SOURCES = new Set(["buildcores", "zol", "manufacturer_cn", "seed"]);
const ACTOR = "hwagent-migration";
const REASON = "hw-agent 精选规格库（723 型号）接管候选池；旧来源降级归档，需要时可将 quality_status 恢复为 supported";

const write = process.argv.includes("--write");
const all = loadCatalogEntries();
const targets = all.filter((entry) => ARCHIVED_SOURCES.has(entry.source));

console.log(`候选降级目标：${targets.length} 条（buildcores/zol/manufacturer_cn/seed）；write=${write}`);
let changed = 0;
for (const entry of targets) {
  if (entry.qualityStatus === "partial") continue; // 已是 partial 无需重复降级
  if (write) {
    setCatalogQualityStatus(entry.id, "partial");
    appendQualityEvent({
      canonicalProductId: entry.id,
      eventType: "deprecated",
      beforeJson: { qualityStatus: entry.qualityStatus },
      afterJson: { qualityStatus: "partial" },
      reason: REASON,
      actor: ACTOR,
    });
  }
  changed += 1;
}
console.log(write ? `已降级 ${changed} 条（含质量事件留痕）。` : `dry-run：将降级 ${changed} 条（加 --write 执行）。`);
closeDatabase();
