"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useDesignSession } from "./use-design-session";
import { SessionTimeline } from "./session-timeline";

/**
 * 会话视图（agent-ui-design §5.3，P2/P3）：/design/[id] 的默认形态。
 * 消息时间线 + 方案卡 + 常驻输入框（有方案=修订、无方案=补充目标）；
 * 完整核验留在 ?view=workbench。
 */
export function DesignSessionView({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { state, submitRevision, submittingRevision, revisionMessage } = useDesignSession(requestId);
  const [revision, setRevision] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);

  const latestProposal = state.proposals.length > 0 ? state.proposals[state.proposals.length - 1]! : null;
  const workbenchHref = `/design/${requestId}?view=workbench`;

  async function submitRevisionForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instruction = revision.trim();
    if (!instruction || submittingRevision) return;
    const ok = await submitRevision(instruction);
    if (ok) setRevision("");
  }

  async function acceptProposal(proposalId: string) {
    setAccepting(true);
    setAcceptError(null);
    try {
      const response = await fetch(`/api/design/${proposalId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "接受方案失败。");
      router.push(`/diy?project=${data.buildId}`);
    } catch (error) {
      setAcceptError(error instanceof Error ? error.message : "接受方案失败，请重试。");
      setAccepting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <main className="session-page">
        <p className="session-loading" role="status">正在载入会话…</p>
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main className="session-page">
        <h1>暂时无法打开这份会话</h1>
        <p>{state.errorMessage ?? "它可能已过期，或者当前服务暂时不可用。"}</p>
        <Link href="/" className="button secondary">返回开始配置</Link>
      </main>
    );
  }

  const headerTitle = latestProposal ? latestProposal.title : "新的方案会话";
  const needsInput = state.question !== null && latestProposal === null;

  return (
    <main className="session-page">
      <header className="session-header">
        <div className="session-header-main">
          <h1>{headerTitle}</h1>
          <span className={`session-run-status ${state.runStatus}`}>
            {state.runStatus === "running" ? "生成中" : state.runStatus === "completed" ? "已完成" : ""}
          </span>
        </div>
        <div className="session-header-actions">
          <Link className="button secondary" href="/">新目标</Link>
          <Link className="button secondary" href={workbenchHref}>完整工作台</Link>
        </div>
      </header>

      <div className="session-stream wb-panel">
        <SessionTimeline
          items={state.timeline}
          proposals={state.proposals}
          changes={state.changes}
          runStatus={state.runStatus}
          latestProposalId={latestProposal?.id ?? null}
          accepting={accepting}
          onAccept={(proposal) => void acceptProposal(proposal.id)}
          workbenchHref={workbenchHref}
        />
      </div>

      {needsInput && (
        <div className="session-needs-input wb-panel">
          <p>{state.question}</p>
          <button
            className="button primary"
            type="button"
            onClick={() => composerInputRef.current?.focus()}
          >
            补充目标
          </button>
        </div>
      )}

      <form className="session-composer wb-panel" onSubmit={(event) => void submitRevisionForm(event)}>
        <label className="sr-only" htmlFor="session-revision-input">
          {latestProposal ? "继续调整这套方案" : "补充你的装机目标"}
        </label>
        <input
          id="session-revision-input"
          ref={composerInputRef}
          name="instruction"
          value={revision}
          onChange={(event) => setRevision(event.target.value)}
          onInput={(event) => setRevision(event.currentTarget.value)}
          placeholder={latestProposal ? "继续调整这套方案，例如：换成白色显卡，预算不要超过 2 万" : "补充预算或用途，我会重新搭配"}
          maxLength={500}
          disabled={submittingRevision}
        />
        <button
          className="button primary session-composer-submit"
          type="submit"
          disabled={submittingRevision || revision.trim().length < 2}
          aria-label={latestProposal ? "提交修改" : "重新生成"}
        >
          {submittingRevision ? "…" : <ArrowRight size={14} aria-hidden />}
        </button>
        {(revisionMessage || acceptError) && (
          <p className="session-composer-feedback" role="status">{revisionMessage ?? acceptError}</p>
        )}
      </form>
    </main>
  );
}
