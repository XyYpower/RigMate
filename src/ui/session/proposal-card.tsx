"use client";

import Link from "next/link";
import type { DesignProposal } from "@/contracts/design";
import { BudgetRuler, budgetRulerFrom } from "@/ui/workbench/budget-ruler";
import { formatYuanRange } from "@/ui/workbench/format";
import { ASSEMBLY_CATEGORY_LABELS } from "@/ui/workbench/assembly-rail";
import { ExperienceAdviceSection } from "@/ui/session/experience-advice";

/**
 * 时间线内的方案卡（agent-ui-design §5.3，P2）：紧凑版配置摘要 + 动作。
 * 完整核验（核验台 / 逐行依据 / 版本对比）留在工作台视图，卡片只给结论与入口。
 */
export function ProposalCard({
  proposal,
  isLatest,
  accepting,
  conflictBlocked,
  onAccept,
  workbenchHref,
}: {
  proposal: DesignProposal;
  isLatest: boolean;
  accepting: boolean;
  conflictBlocked: boolean;
  onAccept: () => void;
  workbenchHref: string;
}) {
  const compatibility = proposal.compatibility;
  return (
    <article className="session-proposal-card wb-panel" aria-label={`方案 v${proposal.version}`}>
      <header className="session-proposal-head">
        <h3>{proposal.title}</h3>
        <span className="session-proposal-version">方案 v{proposal.version}{isLatest ? "" : " · 历史版本"}</span>
      </header>
      <p className="session-proposal-summary">{proposal.summary}</p>
      <BudgetRuler view={budgetRulerFrom(proposal)} />
      <ul className="session-proposal-parts" aria-label="配置摘要">
        {proposal.items.map((item) => (
          <li key={item.category}>
            <span className="session-part-category">{ASSEMBLY_CATEGORY_LABELS[item.category]}</span>
            <span className="session-part-label" title={item.displayNameOriginal ?? item.label}>
              {item.displayName ?? item.label}
            </span>
            <span className="session-part-price mono">{formatYuanRange(item.priceEstimateLowCents, item.priceEstimateHighCents)}</span>
          </li>
        ))}
      </ul>
      <p className="session-proposal-compat">
        <em className="pass">{compatibility.passCount} 通过</em> · <em className="warn">{compatibility.warnCount + compatibility.unknownCount} 待留意</em> ·{" "}
        <em className="block">{compatibility.blockCount} 阻断</em>
        <span className="session-proposal-compat-message">{compatibility.message}</span>
      </p>
      <ExperienceAdviceSection advice={proposal.experienceAdvice} sourceNote={`v${proposal.version} · ${proposal.id.slice(0, 8)}`} />
      <footer className="session-proposal-actions">
        {isLatest ? (
          <>
            <button className="button primary" type="button" onClick={onAccept} disabled={accepting || conflictBlocked}>
              {accepting ? "正在保存并检查…" : "接受这一版"}<span aria-hidden>→</span>
            </button>
            <Link className="button secondary" href="/diy">进入高级 DIY</Link>
          </>
        ) : (
          <span className="session-proposal-history-note">正在查看历史版本，切回最新版后可继续修改</span>
        )}
        <Link className="session-workbench-link" href={workbenchHref}>
          完整工作台<span aria-hidden>→</span>
        </Link>
      </footer>
    </article>
  );
}
