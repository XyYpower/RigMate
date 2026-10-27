"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sessionStatusLabel } from "@/ui/status-vocabulary";
import { LoadError } from "@/ui/components/load-error";

/**
 * 方案会话列表（共享组件）：/projects「AI 会话」页签与 /design 兼容路由双挂载，
 * 两处 UI 保证完全一致（DESIGN.md v3 原则 3：同一实体一个归属地一种长相）。
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

export function SessionListSection() {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [reloadKey]);

  return (
    <section className="session-list-section" aria-label="AI 会话">
      {loadError && <LoadError onRetry={() => { setLoadError(false); setReloadKey((k) => k + 1); }} />}
      {!loadError && sessions === null && <p className="session-loading" role="status">正在载入…</p>}
      {sessions !== null && sessions.length === 0 && (
        <div className="wb-panel session-list-empty">
          <p>还没有会话。回首页描述一个目标，生成过程会在这里留档。</p>
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
    </section>
  );
}
