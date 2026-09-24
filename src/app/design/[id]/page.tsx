"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { productPageUrl } from "@/ui/product-link";
import type { DesignProposal, DesignResult, ProposalItem } from "@/contracts/design";

const CATEGORY_LABELS: Record<string, string> = {
  cpu: "处理器",
  motherboard: "主板",
  gpu: "显卡",
  ram: "内存",
  storage: "存储",
  psu: "电源",
  cooler: "散热",
  case: "机箱",
};

function formatYuan(cents: number | null): string {
  return cents === null ? "待估" : `¥${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

function itemRange(item: ProposalItem): string {
  if (item.priceEstimateLowCents === null || item.priceEstimateHighCents === null) return "价格待确认";
  return `${formatYuan(item.priceEstimateLowCents)}–${formatYuan(item.priceEstimateHighCents)}`;
}

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

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/design/${id}`).then(async (response) => {
      if (response.status === 404) throw new Error("not-found");
      if (!response.ok) throw new Error("load-failed");
      const data = await response.json();
      if (!cancelled) setResult(data.result);
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const proposal: DesignProposal | null = result?.proposal ?? null;
  const changes = result?.changes ?? [];
  const estimateLabel = useMemo(() => {
    if (!proposal || proposal.estimatedLowCents === null || proposal.estimatedHighCents === null) return "暂无足够资料估算总价";
    return `${formatYuan(proposal.estimatedLowCents)}–${formatYuan(proposal.estimatedHighCents)}`;
  }, [proposal]);

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
      router.push(openDiy ? `/diy?project=${data.buildId}` : `/diy?project=${data.buildId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "接受方案失败，请重试。");
      setAccepting(false);
    }
  }

  async function submitRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instruction = String(new FormData(event.currentTarget).get("instruction") ?? "").trim();
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
  if (!proposal) {
    return (
      <main className="design-page">
        <p className="design-kicker">目标已收到</p>
        <h1>还差一点信息</h1>
        <p className="design-summary">{result.run.events.find((event) => event.type === "question")?.message ?? "请补充预算或主要用途，我就能开始搭配。"}</p>
        <Link className="button secondary" href="/">补充目标</Link>
      </main>
    );
  }

  const statusLabel = {
    ok: "主要硬件可行",
    attention: "有取舍需要留意",
    conflict: "存在兼容冲突",
    unknown: "有资料需要确认",
  }[proposal.compatibility.status];

  return (
    <main className="design-page">
      <header className="design-header">
        <div>
          <p className="design-kicker">方案草稿 · 第 {proposal.version} 版</p>
          <h1>{proposal.title}</h1>
          <p className="design-summary">{proposal.summary}</p>
        </div>
        <Link className="design-back" href="/projects">我的方案</Link>
      </header>

      <div className="design-grid">
        <section className="proposal-main" aria-labelledby="proposal-title">
          <div className="proposal-overview">
            <div>
              <span className="overview-label">预算估算</span>
              <strong className="proposal-range">{estimateLabel}</strong>
              <span className="estimate-note">经验估算，非实时成交价</span>
            </div>
            <div className={`compatibility-state ${proposal.compatibility.status}`}>
              <span>{statusLabel}</span>
              <p>{proposal.compatibility.message}</p>
            </div>
          </div>

          <div className="proposal-section-heading">
            <h2 id="proposal-title">建议配置</h2>
            <span>{proposal.items.length} 个核心配件</span>
          </div>
          <div className="proposal-items">
            {proposal.items.map((item) => (
              <article className="proposal-item" key={`${item.category}-${item.catalogId ?? item.label}`}>
                <div className="proposal-category">{CATEGORY_LABELS[item.category] ?? item.category}</div>
                <div className="proposal-item-main">
                  <h3>{item.label}</h3>
                  <p>{item.rationale}</p>
                  {item.confirmationRequired && <p className="proposal-confirmation">需要确认：{item.confirmationReason}</p>}
                </div>
                <div className="proposal-item-price">
                  <span>{itemRange(item)}</span>
                  <small>经验估算</small>
                  <a href={productPageUrl(item.label)} target="_blank" rel="noreferrer">商品页 ↗</a>
                </div>
              </article>
            ))}
          </div>

          {proposal.version > 1 && changes.length > 0 && (
            <section className="proposal-diff" aria-labelledby="diff-title">
              <h2 id="diff-title">相对第 {proposal.version - 1} 版的变化</h2>
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

          <section className="proposal-notes">
            <h2>为什么这样搭配</h2>
            <ul>{proposal.fitNotes.map((note) => <li key={note}>{note}</li>)}</ul>
          </section>
          <section className="proposal-notes">
            <h2>取舍说明</h2>
            <ul>{proposal.tradeoffs.map((note) => <li key={note}>{note}</li>)}</ul>
          </section>
          {proposal.unknowns.length > 0 && (
            <details className="proposal-evidence">
              <summary>查看需要核实的资料与依据</summary>
              <ul>{proposal.unknowns.map((item) => <li key={item}>{item}</li>)}</ul>
              <p>兼容性检查结果、缺失字段和规则编号会在正式 DIY 与报告中完整保留。</p>
            </details>
          )}

          <div className="proposal-actions">
      <button className="button primary" onClick={() => void acceptProposal()} disabled={accepting || proposal.compatibility.status === "conflict"}>
              {accepting ? "正在保存并检查…" : "接受方案，进入 DIY"}<span aria-hidden>→</span>
            </button>
            <button className="button secondary" onClick={() => void acceptProposal(true)} disabled={accepting}>
              自己调整配置
            </button>
            {message && <p className="form-feedback" role="status">{message}</p>}
          </div>
        </section>

        <aside className="agent-activity" aria-labelledby="agent-activity-title">
          <div className="agent-activity-heading">
            <h2 id="agent-activity-title">装机助手</h2>
            <span><i aria-hidden />已完成</span>
          </div>
          <p className="agent-goal">“{result.request.rawInput}”</p>
          <ol>
            {result.run.events.map((event) => (
              <li key={event.id} className={`agent-event ${event.status}`}>
                <span className="agent-event-mark" aria-hidden />
                <div><p>{event.message}</p><time>{new Date(event.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div>
              </li>
            ))}
          </ol>
          <div className="agent-next-step">
            <span>接下来</span>
            <p>你可以接受这一版、进入 DIY 修改，或直接告诉我希望调整的方向。</p>
          </div>
          <form className="revision-row" onSubmit={(event) => void submitRevision(event)}>
            <input
              name="instruction"
              value={revision}
              onChange={(event) => setRevision(event.target.value)}
              onInput={(event) => setRevision(event.currentTarget.value)}
              placeholder="例如：预算压到 1.8 万 / 我已有电源"
              aria-label="调整方案"
              maxLength={500}
              disabled={revising}
            />
            <button className="button secondary" type="submit" disabled={revising || revision.trim().length < 2}>
              {revising ? "正在调整…" : "调整方案"}
            </button>
          </form>
          {revisionMessage && <p className="revision-feedback" role="status">{revisionMessage}</p>}
        </aside>
      </div>
    </main>
  );
}
