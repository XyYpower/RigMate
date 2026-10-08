"use client";

import type { ReactNode } from "react";
import type { AgentEvent, DesignProposal } from "@/contracts/design";
import type { VerificationDeskItem } from "./types";
import { ASSEMBLY_CATEGORY_LABELS } from "./assembly-rail";

/**
 * 核验台（DESIGN.md §6 VerificationDesk）：核验结论按
 * conflict → attention → unknown → pass 固定排序。
 * Agent 事件不在这里生成，只经 `log` 插槽折叠呈现；动作与证据入口由页面注入回调。
 */

const STATE_RANK: Record<VerificationDeskItem["state"], number> = {
  conflict: 0,
  attention: 1,
  unknown: 2,
  pass: 3,
};

const STATE_LABEL: Record<VerificationDeskItem["state"], string> = {
  conflict: "有冲突",
  attention: "待确认",
  unknown: "资料不足",
  pass: "通过",
};

/** DesignProposal → 核验台条目：只用 compatibility / confirmationRequired / unknowns，不猜 */
export function verificationItemsFrom(proposal: DesignProposal): VerificationDeskItem[] {
  const items: VerificationDeskItem[] = [];
  const compat = proposal.compatibility;

  if (compat.status === "conflict") {
    items.push({
      id: "compat-conflict",
      state: "conflict",
      title: compat.message,
      impact: `${compat.blockCount} 项阻断 · ${compat.warnCount} 项待留意，接受前需要先解决`,
      evidenceLabel: null,
      actionLabel: "进入 DIY 修正",
    });
  } else if (compat.status === "attention") {
    items.push({
      id: "compat-attention",
      state: "attention",
      title: compat.message,
      impact: `${compat.warnCount} 项待留意 · ${compat.unknownCount} 项资料不足`,
      evidenceLabel: null,
      actionLabel: null,
    });
  }

  for (const item of proposal.items) {
    if (!item.confirmationRequired) continue;
    items.push({
      id: `pending-${item.category}`,
      state: "attention",
      title: item.confirmationReason ?? `${ASSEMBLY_CATEGORY_LABELS[item.category]}需要你确认`,
      impact: `涉及：${item.label}。确认后即可接受方案。`,
      evidenceLabel: item.rationale ? "看选择理由" : null,
      actionLabel: null,
    });
  }

  for (const [index, unknown] of proposal.unknowns.entries()) {
    items.push({
      id: `unknown-${index}`,
      state: "unknown",
      title: unknown,
      impact: "需要核实后才能作为搭配依据",
      evidenceLabel: null,
      actionLabel: null,
    });
  }

  if (compat.status === "ok") {
    items.push({
      id: "compat-pass",
      state: "pass",
      title: "兼容性检查全部通过",
      impact: `${compat.passCount} 项规则通过`,
      evidenceLabel: null,
      actionLabel: null,
    });
  }

  return items.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
}

/** 四阶段轨道：理解目标 → 检索目录 → 搭配方案 → 核验清单（来自真实 AgentEvent） */
export type StageTrackStep = {
  id: "understanding" | "retrieving" | "composing" | "validating";
  label: string;
  state: "done" | "active" | "waiting";
};

const DESIGN_STAGES: { id: StageTrackStep["id"]; label: string }[] = [
  { id: "understanding", label: "理解目标" },
  { id: "retrieving", label: "检索目录" },
  { id: "composing", label: "搭配方案" },
  { id: "validating", label: "核验清单" },
];

export function stageTrackFromEvents(events: AgentEvent[]): StageTrackStep[] {
  return DESIGN_STAGES.map(({ id, label }) => {
    const stageEvents = events.filter((event) => event.type === id);
    const state: StageTrackStep["state"] = stageEvents.some((event) => event.status === "completed")
      ? "done"
      : stageEvents.some((event) => event.status === "started" || event.status === "waiting")
        ? "active"
        : "waiting";
    return { id, label, state };
  });
}

export function StageTrack({ steps }: { steps: StageTrackStep[] }) {
  return (
    <ol className="stage-track" aria-label="方案生成四阶段">
      {steps.map((step) => (
        <li className={`stage-track-step ${step.state}`} key={step.id}>
          <span className="stage-track-mark" aria-hidden />
          <span className="stage-track-label">{step.label}</span>
          <span className="stage-track-state">
            {step.state === "done" ? "已完成" : step.state === "active" ? "进行中" : "等待中"}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function VerificationDesk({
  items,
  track,
  log,
  onAction,
  onEvidence,
}: {
  items: VerificationDeskItem[];
  /** 四阶段轨道（由页面层从真实 AgentEvent 映射后传入） */
  track?: ReactNode;
  log?: ReactNode;
  onAction?: (item: VerificationDeskItem) => void;
  onEvidence?: (item: VerificationDeskItem) => void;
}) {
  const sorted = [...items].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
  return (
    <section className="wb-panel verification-desk" aria-label="核验台">
      <div className="verification-desk-head">
        <h2>核验台</h2>
        <span className="verification-desk-count">
          {sorted.filter((item) => item.state === "conflict").length > 0
            ? "有冲突待解决"
            : sorted.some((item) => item.state === "attention" || item.state === "unknown")
              ? "有事项待处理"
              : "全部通过"}
        </span>
      </div>
      {track}
      <ul className="verification-desk-list">
        {sorted.map((item) => (
          <li className={`verification-item item-${item.state}`} key={item.id}>
            <div className="verification-item-main">
              <span className={`verification-item-state state-${item.state}`}>{STATE_LABEL[item.state]}</span>
              <p className="verification-item-title">{item.title}</p>
              <p className="verification-item-impact">{item.impact}</p>
            </div>
            <div className="verification-item-actions">
              {item.evidenceLabel && (
                <button type="button" className="verification-evidence" onClick={() => onEvidence?.(item)}>
                  {item.evidenceLabel}
                </button>
              )}
              {item.actionLabel && onAction && (
                <button type="button" className="button secondary verification-action" onClick={() => onAction(item)}>
                  {item.actionLabel}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {log && (
        <details className="verification-log">
          <summary>处理记录</summary>
          {log}
        </details>
      )}
    </section>
  );
}
