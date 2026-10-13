"use client";

import { Fragment } from "react";
import type { DesignProposal, ProposalChange } from "@/contracts/design";
import type { SessionRunStatus, TimelineItem } from "./session-state";
import { toolMetaOf, toolSummaryOf } from "./tool-renderers";
import { ProposalCard } from "./proposal-card";

/**
 * 会话时间线（agent-ui-design §5.3，P2）：TimelineItem[] → 消息流。
 * 相位 = 步骤点；工具 = 可折叠块（状态点 + 摘要 + 命中明细）；
 * 追问 = 醒目提示卡；方案 = 富卡片。相邻工具块与相位同文案时不重复摘要行。
 */

const PHASE_LABELS: Record<string, string> = {
  received: "接收目标",
  screened: "安全筛查",
  understanding: "理解目标",
  retrieved: "检索目录",
  composed: "搭配方案",
  validated: "核验清单",
  answered: "方案就绪",
};

const CATEGORY_LABELS: Record<string, string> = {
  cpu: "处理器",
  motherboard: "主板",
  gpu: "显卡",
  ram: "内存",
  storage: "存储",
  psu: "电源",
  cooler: "散热器",
  case: "机箱",
};

function formatTime(at: string): string {
  return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function SessionTimeline({
  items,
  proposals,
  changes,
  runStatus,
  latestProposalId,
  accepting,
  onAccept,
  workbenchHref,
}: {
  items: TimelineItem[];
  proposals: DesignProposal[];
  changes: ProposalChange[];
  runStatus: SessionRunStatus;
  latestProposalId: string | null;
  accepting: boolean;
  onAccept: (proposal: DesignProposal) => void;
  workbenchHref: string;
}) {
  return (
    <ol className="session-timeline" aria-label="方案会话时间线">
      {items.map((item, index) => {
        const previous = index > 0 ? items[index - 1] : null;
        return (
          <li className={`session-item session-item-${item.kind}`} key={`${item.kind}-${item.seq}`}>
            <time className="session-item-time mono" aria-hidden>{formatTime(item.at)}</time>
            <span className="session-item-mark" aria-hidden />
            <div className="session-item-body">{renderItem(item, previous, { proposals, changes, latestProposalId, accepting, onAccept, workbenchHref })}</div>
          </li>
        );
      })}
      {runStatus === "running" && (
        <li className="session-item session-item-running" aria-label="生成进行中">
          <time className="session-item-time mono" aria-hidden>{formatTime(new Date().toISOString())}</time>
          <span className="session-item-mark" aria-hidden />
          <div className="session-item-body"><span className="session-running-hint">正在生成…</span></div>
        </li>
      )}
    </ol>
  );
}

function renderItem(
  item: TimelineItem,
  previous: TimelineItem | null,
  context: {
    proposals: DesignProposal[];
    changes: ProposalChange[];
    latestProposalId: string | null;
    accepting: boolean;
    onAccept: (proposal: DesignProposal) => void;
    workbenchHref: string;
  },
) {
  switch (item.kind) {
    case "run_started":
      return <p className="session-run-divider">第 {item.runNumber} 轮 · {item.model === "rule-engine" ? "本地规则" : `模型 ${item.model}`}</p>;
    case "user":
      return <p className="session-user-text">{item.text}</p>;
    case "phase": {
      const label = PHASE_LABELS[item.phase] ?? item.phase;
      return (
        <p className="session-phase-text">
          <span className="session-phase-label">{label}</span>
          {item.message}
        </p>
      );
    }
    case "tool": {
      const meta = toolMetaOf(item.tool);
      const duplicated = previous?.kind === "phase" && previous.message === item.detail;
      const summary = toolSummaryOf(item);
      return (
        <details className={`session-tool state-${item.state}`} open={item.state === "running"}>
          <summary>
            <span className="session-tool-state" aria-hidden />
            <span className="session-tool-label">{meta.label}</span>
            <span className="session-tool-summary">{duplicated ? "" : summary}</span>
          </summary>
          {item.resultIds.length > 0 && (
            <div className="session-tool-detail">
              <span className="session-tool-detail-label">{meta.detailLabel ?? "命中"}</span>
              <ul className="session-tool-ids">
                {item.resultIds.map((id) => (
                  <li key={id} className="mono">{id}</li>
                ))}
              </ul>
            </div>
          )}
        </details>
      );
    }
    case "anomaly":
      return (
        <p className="session-anomaly-text">
          {item.message}
          {item.fallback && (
            <span className="session-anomaly-fallback">已从 {item.fallback.from} 回退到 {item.fallback.to}。</span>
          )}
        </p>
      );
    case "question":
      return <p className="session-question-text">{item.message}</p>;
    case "proposal": {
      const proposal = context.proposals.find((entry) => entry.id === item.proposalId);
      if (!proposal) {
        return <p className="session-phase-text"><span className="session-phase-label">方案就绪</span>{item.title}（v{item.version}）</p>;
      }
      const isLatest = item.proposalId === context.latestProposalId;
      const changedCategories = isLatest && proposal.version > 1 ? context.changes : [];
      return (
        <div className="session-proposal-wrap">
          {changedCategories.length > 0 && (
            <p className="session-proposal-diff-hint">
              较上一版调整了{" "}
              {changedCategories.map((change) => CATEGORY_LABELS[change.category] ?? change.category).join("、")}
            </p>
          )}
          <ProposalCard
            proposal={proposal}
            isLatest={isLatest}
            accepting={context.accepting}
            conflictBlocked={proposal.compatibility.status === "conflict"}
            onAccept={() => context.onAccept(proposal)}
            workbenchHref={context.workbenchHref}
          />
        </div>
      );
    }
    default:
      return <Fragment />;
  }
}

export { CATEGORY_LABELS as SESSION_CATEGORY_LABELS };
