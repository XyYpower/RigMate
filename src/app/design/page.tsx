"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sessionStatusLabel } from "@/ui/status-vocabulary";

/**
 * 方案会话列表（agent-ui-design §5.3，P3）：/design。
 * 每个设计请求是一个会话——点开继续调整；新建目标回首页。
 * 状态词来自全站统一词表（status-vocabulary）。
 */

type SessionListItem = {
  id: string;
  rawInput: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  latest: { id: string; version: number; title: string; proposalStatus: string } | null;
  acceptedBuildId: string | null;
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function DesignSessionsPage() {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/design").then(async (response) => {
      if (!response.ok) throw new Error("load-failed");
      const data = await response.json();
      if (!cancelled) setSessions(data.requests ?? []);
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="session-page session-list-page">
      <header className="session-header">
        <div className="session-header-main">
          <h1>方案会话</h1>
        </div>
        <div className="session-header-actions">
          <Link className="button primary" href="/">新建目标</Link>
        </div>
      </header>

      {loadError && <p className="session-loading" role="status">暂时打不开会话列表，请稍后重试。</p>}
      {!loadError && sessions === null && <p className="session-loading" role="status">正在载入会话列表…</p>}
      {sessions !== null && sessions.length === 0 && (
        <div className="wb-panel session-list-empty">
          <p>还没有方案会话。回首页描述一个目标，生成过程会在这里留档。</p>
          <Link className="button primary" href="/">开始第一个目标</Link>
        </div>
      )}
      {sessions !== null && sessions.length > 0 && (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link className="session-list-item wb-panel" href={`/design/${session.id}`}>
                <div className="session-list-item-main">
                  <p className="session-list-goal">{session.rawInput}</p>
                  <p className="session-list-meta">
                    {session.latest
                      ? `${session.latest.title} · 方案 v${session.latest.version}`
                      : sessionStatusLabel(session.status, session.acceptedBuildId)}
                    <span className="session-list-time mono">{formatTime(session.updatedAt)}</span>
                  </p>
                </div>
                <span className={`session-list-status status-${session.status}`}>
                  {sessionStatusLabel(session.status, session.acceptedBuildId)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
