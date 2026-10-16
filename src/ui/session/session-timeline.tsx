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

/**
 * 时间线降噪（agent-ui 反馈：不向用户展示"agent 已帮你怎么样"的过程噪音）：
 * - 隐藏机械相位（接收目标/安全筛查）；
 * - 同名工具的 running→终态合并为终态一块；
 * - 与相邻相位同文案的汇总块不重复出现；
 * - 连续的逐类目 searchCatalog 合并为一行检索摘要（可展开看每类命中）。
 * 折叠只发生在展示层，事件流（reducer）保持完整可审计。
 */
type DisplayItem =
  | { kind: "item"; item: TimelineItem }
  | { kind: "search-group"; seq: number; at: string; categories: number; hits: number; details: string[] };

function toDisplayItems(items: TimelineItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let lastPhaseMessage: string | null = null;
  const lastToolDetail = (): string | null => {
    const last = out.at(-1);
    if (!last) return null;
    if (last.kind === "item" && last.item.kind === "tool") return last.item.detail;
    if (last.kind === "search-group") return last.details.at(-1) ?? null;
    return null;
  };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.kind === "phase" && (item.phase === "received" || item.phase === "screened")) continue;
    if (item.kind === "tool") {
      // 与最近相位同文案的汇总块不重复展示（同一次 mapper 输出里 phase 和 tool 相邻或隔一个同名块）
      if (lastPhaseMessage !== null && lastPhaseMessage === item.detail) continue;
      const previous = items[index - 1];
      if (previous && previous.kind === "phase" && previous.message === item.detail) continue;
      const last = out.at(-1);
      if (last && last.kind === "item" && last.item.kind === "tool" && last.item.tool === item.tool && item.state !== "running") {
        out[out.length - 1] = { kind: "item", item };
        continue;
      }
    }
    if (item.kind === "phase") {
      const previousDetail = lastToolDetail();
      if (previousDetail !== null && previousDetail === item.message) continue;
      lastPhaseMessage = item.message;
    }
    if (item.kind === "tool" && item.tool === "searchCatalog" && item.state !== "error") {
      const details: string[] = [];
      let hits = 0;
      let cursor = index;
      while (cursor < items.length) {
        const entry = items[cursor]!;
        if (entry.kind !== "tool" || entry.tool !== "searchCatalog" || entry.state === "error") break;
        if (entry.state === "done") {
          hits += entry.resultIds.length;
          details.push(entry.detail);
        }
        cursor += 1;
      }
      out.push({ kind: "search-group", seq: item.seq, at: item.at, categories: details.length, hits, details });
      index = cursor - 1;
      continue;
    }
    out.push({ kind: "item", item });
  }
  return out;
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
  const displayItems = toDisplayItems(items);
  return (
    <ol className="session-timeline" aria-label="方案会话时间线">
      {displayItems.map((entry, index) => {
        const item = entry.kind === "item" ? entry.item : null;
        const previous = index > 0 ? displayItems[index - 1] : null;
        const previousItem = previous?.kind === "item" ? previous.item : null;
        const key = entry.kind === "search-group" ? `search-group-${entry.seq}` : `${item!.kind}-${item!.seq}`;
        return (
          <li className={`session-item session-item-${item?.kind ?? "search-group"}`} key={key}>
            <time className="session-item-time mono" aria-hidden>{formatTime(item?.at ?? (entry.kind === "search-group" ? entry.at : ""))}</time>
            <span className="session-item-mark" aria-hidden />
            <div className="session-item-body">
              {entry.kind === "search-group"
                ? renderSearchGroup(entry)
                : renderItem(item!, previousItem, { proposals, changes, latestProposalId, accepting, onAccept, workbenchHref })}
            </div>
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

function renderSearchGroup(group: Extract<DisplayItem, { kind: "search-group" }>) {
  return (
    <details className="session-tool state-done">
      <summary>
        <span className="session-tool-state" aria-hidden />
        <span className="session-tool-label">检索目录</span>
        <span className="session-tool-summary">{group.categories} 类 · 命中 {group.hits} 个候选</span>
      </summary>
      <div className="session-tool-detail">
        <span className="session-tool-detail-label">逐类命中</span>
        <ul className="session-tool-lines">
          {group.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      </div>
    </details>
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
    case "answer":
      // 结构化回答卡（M6 信任层）：内容全部来自方案事实（AnswerDraft），按行渲染
      return (
        <div className="session-answer" aria-label="装机助手的回答">
          <span className="session-answer-label">装机助手</span>
          <div className="session-answer-body">
            {item.summary.split("\n").map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
          {item.actions.length > 0 && (
            <p className="session-answer-actions">接下来可以：{item.actions.join("；")}。</p>
          )}
        </div>
      );
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
