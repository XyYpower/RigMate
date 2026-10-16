import { answerDraftSchema, type AnswerDraft, type DesignProposal } from "@/contracts/design";
import type { BuildItemCategory } from "@/domain/build/types";
import { categoriesMentionedIn } from "./revision";

/**
 * 确定性解释通道（M4，blueprint §2 compatibility_explain 模板路径、§7.4 回答渲染）。
 *
 * 回答只组装方案里已存在的事实——入选理由（rationale）、质量状态、价格口径、兼容结论、
 * 未知项——中文文案由渲染器生成，模型零参与：这是"回答不能新增数字或型号"的最强实现。
 * 问句定位不到方案内类别时返回 null，调用方回落到通用指引（M3 行为）。
 */

const CATEGORY_LABELS: Record<BuildItemCategory, string> = {
  cpu: "处理器",
  motherboard: "主板",
  gpu: "显卡",
  ram: "内存",
  storage: "存储",
  psu: "电源",
  cooler: "散热器",
  case: "机箱",
};

const PRICE_BASIS_LABELS: Record<string, string> = {
  evidence: "已审核价格",
  experience_estimate: "经验估算",
  unknown: "暂无价格",
};

const SOURCE_LEVEL_LABELS: Record<string, string> = {
  verified_catalog: "已核验目录",
  supported_catalog: "有参考资料目录",
  user_input: "用户输入",
  price_evidence: "价格证据",
  model_experience: "模型经验",
  unknown: "来源未知",
};

const OVERALL_PATTERN = /这么搭|这样搭|这么配|这样配|搭配思路|整体|全套|每一件|都[是选]什么/;

function priceNote(item: DesignProposal["items"][number]): string {
  if (item.priceBasis === "unknown" || item.priceEstimateLowCents === null || item.priceEstimateHighCents === null) {
    return "暂无价格";
  }
  const low = Math.round(item.priceEstimateLowCents / 100).toLocaleString("zh-CN");
  const high = Math.round(item.priceEstimateHighCents / 100).toLocaleString("zh-CN");
  return `${PRICE_BASIS_LABELS[item.priceBasis] ?? item.priceBasis} ¥${low}–${high}`;
}

function itemLine(item: DesignProposal["items"][number]): string {
  const label = CATEGORY_LABELS[item.category] ?? item.category;
  const source = SOURCE_LEVEL_LABELS[item.sourceLevel] ?? item.sourceLevel;
  return `【${label}】${item.displayName ?? item.label}：${item.rationale}（${priceNote(item)} · ${source}）`;
}

export function buildExplainAnswer(input: {
  instruction: string;
  proposal: DesignProposal;
}): AnswerDraft | null {
  const proposal = input.proposal;
  const overall = OVERALL_PATTERN.test(input.instruction);
  const mentioned = categoriesMentionedIn(input.instruction).filter((category) =>
    proposal.items.some((item) => item.category === category),
  );
  if (!overall && mentioned.length === 0) return null;

  const targetCategories: BuildItemCategory[] =
    mentioned.length > 0 ? mentioned : proposal.items.map((item) => item.category);
  const lines = proposal.items
    .filter((item) => targetCategories.includes(item.category))
    .map(itemLine);

  const summaryParts = [...lines];
  if (overall) summaryParts.push(`兼容性：${proposal.compatibility.message}`);
  if (proposal.unknowns.length > 0) {
    const joined = proposal.unknowns.join("、");
    // unknown 条目可能自带句号：不重复追加
    summaryParts.push(`需要留意的未知项：${joined}${/[。.!?！？]$/.test(joined) ? "" : "。"}`);
  }

  const adviceIds = proposal.experienceAdvice
    .map((advice, index) => (targetCategories.includes(advice.category) ? index : -1))
    .filter((index) => index >= 0);

  return answerDraftSchema.parse({
    summary: summaryParts.join("\n"),
    actions: ["继续调整：直接说要改哪里", "接受这一版", "进入高级 DIY"],
    questions: [],
    claimIds: [],
    adviceIds,
  });
}

/** 中文渲染：只输出 draft 里已有的事实与动作，不新增内容 */
export function renderAnswerDraft(draft: AnswerDraft): string {
  const actions = draft.actions.length > 0 ? `\n\n可以这样调整：${draft.actions.join("；")}。` : "";
  return `${draft.summary}${actions}`;
}
