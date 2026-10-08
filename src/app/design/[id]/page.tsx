"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AgentProgressCard, toTimelineSteps } from "@/ui/workbench/agent-progress-card";
import { BuildPartsTable } from "@/ui/workbench/build-parts-table";
import { BuildSummaryCard } from "@/ui/workbench/build-summary-card";
import { DecisionBanner } from "@/ui/workbench/decision-banner";
import { RequirementCard } from "@/ui/workbench/requirement-card";
import { WorkspaceHeader } from "@/ui/workbench/workspace-header";
import { formatYuanParts } from "@/ui/workbench/format";
import { BudgetRuler, budgetRulerFrom } from "@/ui/workbench/budget-ruler";
import { AssemblyRail, assemblySlotsFromProposal } from "@/ui/workbench/assembly-rail";
import {
  StageTrack,
  VerificationDesk,
  stageTrackFromEvents,
  verificationItemsFrom,
} from "@/ui/workbench/verification-desk";
import type { DesignResult } from "@/contracts/design";
import { workspaceStatusOf } from "@/ui/workbench/types";
import { diffProposals } from "@/domain/design/diff";

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

export default function DesignPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [result, setResult] = useState<DesignResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState("");
  const [revising, setRevising] = useState(false);
  const [revisionMessage, setRevisionMessage] = useState("");
  const [viewedVersion, setViewedVersion] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/design/${id}`).then(async (response) => {
      if (response.status === 404) throw new Error("not-found");
      if (!response.ok) throw new Error("load-failed");
      const data = await response.json();
      if (!cancelled) {
        setResult(data.result);
        setViewedVersion(data.result.proposal?.version ?? null);
      }
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const proposal = result?.proposal ?? null;
  const viewedProposal = result && viewedVersion !== null
    ? result.versions.find((version) => version.version === viewedVersion) ?? proposal
    : proposal;
  const isHistoryView = Boolean(viewedProposal && proposal && viewedProposal.id !== proposal.id);
  const changes = viewedProposal
    ? (isHistoryView
      ? diffProposals(result?.versions.find((version) => version.version === viewedProposal.version - 1) ?? null, viewedProposal)
      : (result?.changes ?? []))
    : [];
  const compatibility = viewedProposal?.compatibility;
  const estimateMidpoint = useMemo(() => {
    if (!viewedProposal || viewedProposal.estimatedLowCents === null || viewedProposal.estimatedHighCents === null) return null;
    return Math.round((viewedProposal.estimatedLowCents + viewedProposal.estimatedHighCents) / 2);
  }, [viewedProposal]);

  async function acceptProposal(openDiy = false) {
    if (!proposal) return;
    setAccepting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/design/${proposal.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowConflicts: openDiy }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "接受方案失败。");
      router.push(`/diy?project=${data.buildId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "接受方案失败，请重试。");
      setAccepting(false);
    }
  }

  async function submitRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instruction = revision.trim();
    if (!instruction || revising) return;
    setRevising(true);
    setRevisionMessage("");
    try {
      const response = await fetch(`/api/design/${result!.request.id}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = (await response.json()) as { result: DesignResult };
      if (!response.ok) throw new Error((data as { error?: string }).error ?? "调整失败，请重试。");
      setResult(data.result);
      setViewedVersion(data.result.proposal?.version ?? null);
      setRevision("");
      const question = data.result.run.events.find((item) => item.type === "question");
      setRevisionMessage(
        question
          ? question.message
          : data.result.proposal
            ? `已生成第 ${data.result.proposal.version} 版方案。`
            : "调整已完成。",
      );
    } catch (error) {
      setRevisionMessage(error instanceof Error ? error.message : "调整失败，请重试。");
    } finally {
      setRevising(false);
    }
  }

  if (loading) {
    return (
      <main className="design-page">
        <div className="agent-progress" role="status" aria-label="方案加载中">
          <span className="agent-step active">读取目标</span>
          <span className="agent-step active">整理方案</span>
          <span className="agent-step active">汇总校验</span>
        </div>
      </main>
    );
  }
  if (loadError || !result) {
    return <main className="design-page"><h1>暂时无法打开这份方案</h1><p>它可能已过期，或者当前服务暂时不可用。</p><Link href="/">返回开始配置</Link></main>;
  }
  if (!proposal || !viewedProposal) {
    return (
      <main className="design-page">
        <h1>还差一点信息</h1>
        <p>{result.run.events.find((event) => event.type === "question")?.message ?? "请补充预算或主要用途，我就能开始搭配。"}</p>
        <Link className="button secondary" href="/">补充目标</Link>
      </main>
    );
  }

  const status = workspaceStatusOf(viewedProposal);
  const pendingItems = viewedProposal.items.filter((item) => item.confirmationRequired);
  const revisionForm = (
    <form className="revision-inline" onSubmit={(event) => void submitRevision(event)}>
      <label className="sr-only" htmlFor="revision-inline-input">继续调整这套方案</label>
      <input
        id="revision-inline-input"
        name="instruction"
        value={revision}
        onChange={(event) => setRevision(event.target.value)}
        onInput={(event) => setRevision(event.currentTarget.value)}
        placeholder="继续调整这套方案，例如：换成白色显卡，预算不要超过 2 万"
        maxLength={500}
        disabled={revising || isHistoryView}
      />
      <button className="button secondary revision-inline-submit" type="submit" disabled={revising || revision.trim().length < 2} aria-label="提交修改">
        {revising ? "…" : <span aria-hidden>→</span>}
      </button>
    </form>
  );

  const budgetSummary = viewedProposal.budgetCents !== null
    ? `预算 ${formatYuanParts(viewedProposal.budgetCents)}${estimateMidpoint !== null ? ` · 估中值 ${formatYuanParts(estimateMidpoint)}` : ""}`
    : "预算从描述中识别";

  const requirementItems = [
    { label: "预算", value: viewedProposal.budgetCents !== null ? `${formatYuanParts(viewedProposal.budgetCents)} 以内` : "从描述中识别" },
    { label: "主要用途", value: result.request.intent.useCases.join(" / ") || "未指定" },
    {
      label: "外观偏好",
      value: result.request.intent.appearance.join(" / ") || "未指定",
    },
    {
      label: "特殊要求",
      value: [...result.request.intent.existingParts, ...result.request.intent.constraints].join(" / ") || "兼容性好，稳定耐用",
    },
  ];

  function openPartsRow(category: string) {
    const row = document.querySelector(`.build-parts-row[data-category="${category}"]`);
    if (row instanceof HTMLDetailsElement) {
      row.open = true;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /** 核验台面板：≥1200px 在右栏，<1200px 内联到配置清单之后（同一内容两处挂载，CSS 控制可见） */
  const deskPanel = (
    <VerificationDesk
      items={verificationItemsFrom(viewedProposal)}
      track={<StageTrack steps={stageTrackFromEvents(result.run.events)} />}
      log={<AgentProgressCard steps={toTimelineSteps(result.run.events)} />}
      onAction={(item) => {
        if (item.id === "compat-conflict") void acceptProposal(true);
      }}
      onEvidence={(item) => {
        const category = item.id.startsWith("pending-") ? item.id.slice("pending-".length) : null;
        if (category) openPartsRow(category);
      }}
    />
  );

  return (
    <main className="design-page">
      <WorkspaceHeader
        title={<>{viewedProposal.title} <span className="header-title-version">· 方案 v{viewedProposal.version}{isHistoryView ? " · 历史版本" : ""}</span></>}
        status={status}
        summary={<span className="header-budget-summary">{budgetSummary}</span>}
        actions={
          !isHistoryView ? (
            <label className="version-picker">
              <span className="sr-only">方案版本</span>
              <select
                aria-label="方案版本"
                value={String(viewedProposal.version)}
                onChange={(event) => setViewedVersion(Number(event.target.value))}
              >
                {result.versions.slice().reverse().map((version) => (
                  <option key={version.id} value={version.version}>
                    第 {version.version} 版{version.id === proposal.id ? " · 最新" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="history-banner">正在查看历史版本，切回最新版后可继续修改</span>
          )
        }
      />

      <div className="page-grid">
        <div className="page-main">
          <BudgetRuler view={budgetRulerFrom(viewedProposal)} />

          <BuildSummaryCard proposal={viewedProposal} />

          <section className="design-rail-section" aria-label="本方案装配轨道">
            <AssemblyRail slots={assemblySlotsFromProposal(viewedProposal)} layout="grid" />
          </section>

          <section className="wb-panel build-parts-section" aria-labelledby="parts-title">
            <div className="build-parts-section-head">
              <h2 id="parts-title">配置清单</h2>
              <span>核验状态逐行可见，可展开调整</span>
            </div>
            <BuildPartsTable items={viewedProposal.items} />
          </section>

          <div className="design-desk-inline">{deskPanel}</div>

          {viewedProposal.version > 1 && changes.length > 0 && (
            <section className="wb-panel proposal-diff" aria-labelledby="diff-title">
              <h2 id="diff-title">相对第 {viewedProposal.version - 1} 版的变化</h2>
              <ul>
                {changes.map((change) => (
                  <li key={change.category}>
                    <span className="diff-category">{CATEGORY_LABELS[change.category] ?? change.category}</span>
                    {change.fromLabel ? <s>{change.fromLabel}</s> : <em className="diff-tag">新增</em>}
                    <span className="diff-arrow" aria-hidden>→</span>
                    {change.toLabel ? <strong>{change.toLabel}</strong> : <em className="diff-tag removed">不再购置</em>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!isHistoryView && pendingItems.length > 0 && (
            <DecisionBanner
              title={pendingItems[0]!.confirmationReason ?? "有配置项需要你确认"}
              description={`涉及：${pendingItems.map((item) => CATEGORY_LABELS[item.category] ?? item.category).join("、")}。确认后即可接受方案，或在高级 DIY 中更换。`}
              actions={
                <>
                  <button className="button primary" onClick={() => void acceptProposal()} disabled={accepting || compatibility?.status === "conflict"}>
                    保留当前配置并接受
                  </button>
                  <button className="button secondary" onClick={() => void acceptProposal(true)} disabled={accepting}>
                    进入 DIY 更换
                  </button>
                </>
              }
            />
          )}

          {!isHistoryView && revisionForm}

          <section className="wb-panel design-notes" aria-label="搭配说明与依据">
            <details>
              <summary>为什么这样搭配 / 取舍说明</summary>
              <h3>为什么这样搭配</h3>
              <ul>{viewedProposal.fitNotes.map((note) => <li key={note}>{note}</li>)}</ul>
              <h3>取舍说明</h3>
              <ul>{viewedProposal.tradeoffs.map((note) => <li key={note}>{note}</li>)}</ul>
              {viewedProposal.unknowns.length > 0 && (
                <>
                  <h3>需要核实的资料</h3>
                  <ul>{viewedProposal.unknowns.map((item) => <li key={item}>{item}</li>)}</ul>
                </>
              )}
            </details>
          </section>

          <div className="proposal-actions">
            {!isHistoryView && (
              <>
                <button
                  className={`button ${pendingItems.length > 0 || compatibility?.status === "conflict" ? "secondary" : "primary"}`}
                  onClick={() => void acceptProposal()}
                  disabled={accepting || compatibility?.status === "conflict"}
                >
                  {accepting ? "正在保存并检查…" : "接受这一版"}<span aria-hidden>→</span>
                </button>
                <Link className="button secondary" href={`/diy`}>进入高级 DIY</Link>
              </>
            )}
            {message && <p className="form-feedback" role="status">{message}</p>}
            {revisionMessage && <p className="revision-feedback" role="status">{revisionMessage}</p>}
          </div>
        </div>

        <aside className="workbench-aside page-level">
          <div className="design-desk-aside">{deskPanel}</div>
          <RequirementCard items={requirementItems} />
          <section className="wb-panel design-status-strip" aria-label="方案状态">
            <div>
              <span>预算总价</span>
              <strong>{estimateMidpoint !== null ? formatYuanParts(estimateMidpoint) : "待估"}</strong>
            </div>
            <div>
              <span>配置件数</span>
              <strong>{viewedProposal.items.length}</strong>
            </div>
            <div>
              <span>兼容性检查</span>
              <strong className="design-status-compat">
                {compatibility ? (
                  <>
                    <em className="pass">{compatibility.passCount} 通过</em> · <em className="warn">{compatibility.warnCount + compatibility.unknownCount} 待留意</em> · <em className="block">{compatibility.blockCount} 阻断</em>
                  </>
                ) : "—"}
              </strong>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
