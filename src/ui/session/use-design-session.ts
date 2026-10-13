"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RigEnvelope } from "@/contracts/agent-events";
import { applyEnvelope, hydrateSnapshot, initialSessionState, type SessionSnapshot, type SessionState } from "./session-state";

/**
 * 会话状态钩子（agent-ui-design §5.1，P2）。
 *
 * 引导 = GET 快照（全量事件 + 方案实体）；实时 = EventSource 订阅 SSE，
 * 断线由 EventSource 原生 Last-Event-ID 续传。事件按 seq 幂等折叠，
 * 快照与流的投递顺序竞态由 hydrateSnapshot 补齐（见 session-state.ts）。
 */
export function useDesignSession(requestId: string) {
  const [state, setState] = useState<SessionState>(initialSessionState);
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [revisionMessage, setRevisionMessage] = useState<string | null>(null);

  const bootstrap = useCallback(async (): Promise<SessionSnapshot | null> => {
    try {
      const response = await fetch(`/api/design/${requestId}`);
      if (!response.ok) {
        setState((prev) => ({ ...prev, status: "error", errorMessage: "暂时无法打开这份会话，它可能已过期。" }));
        return null;
      }
      const snapshot = (await response.json()) as SessionSnapshot;
      setState((prev) => hydrateSnapshot(prev, snapshot));
      return snapshot;
    } catch {
      setState((prev) => ({ ...prev, status: "error", errorMessage: "暂时无法打开这份会话，请稍后重试。" }));
      return null;
    }
  }, [requestId]);

  useEffect(() => {
    // 快照引导：setState 都在 .then 回调里（react-hooks/set-state-in-effect），
    // cancelled 防止卸载后写入
    let cancelled = false;
    void fetch(`/api/design/${requestId}`)
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setState((prev) => ({ ...prev, status: "error", errorMessage: "暂时无法打开这份会话，它可能已过期。" }));
          return;
        }
        const snapshot = (await response.json()) as SessionSnapshot;
        if (!cancelled) setState((prev) => hydrateSnapshot(prev, snapshot));
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ ...prev, status: "error", errorMessage: "暂时无法打开这份会话，请稍后重试。" }));
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const openStreamRef = useRef<EventSource | null>(null);
  const openStream = useCallback((): EventSource => {
    openStreamRef.current?.close();
    const source = new EventSource(`/api/design/${requestId}/stream`);
    source.addEventListener("rig", (event) => {
      const envelope = JSON.parse((event as MessageEvent<string>).data) as RigEnvelope;
      setState((prev) => applyEnvelope(prev, envelope));
    });
    // onerror 由 EventSource 自动重连（带 Last-Event-ID）；服务端主动收口（run_completed）也触发 error，
    // 此时 readyState 为 CLOSED，直接放弃这条连接即可
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) source.close();
    };
    openStreamRef.current = source;
    return source;
  }, [requestId]);

  useEffect(() => {
    const source = openStream();
    return () => source.close();
  }, [openStream]);

  /** 自然语言修订：先开流抓实时事件，POST 完成后快照引导补齐方案实体（幂等折叠去重） */
  const submitRevision = useCallback(
    async (instruction: string): Promise<boolean> => {
      if (submittingRevision) return false;
      setSubmittingRevision(true);
      setRevisionMessage(null);
      const source = openStream();
      try {
        const response = await fetch(`/api/design/${requestId}/revisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction }),
        });
        const data = (await response.json()) as { result?: { run: { events: Array<{ type: string; message: string }> } }; error?: string };
        if (!response.ok) throw new Error(data.error ?? "调整失败，请重试。");
        await bootstrap();
        const question = data.result?.run.events.find((item) => item.type === "question");
        setRevisionMessage(question ? question.message : null);
        return true;
      } catch (error) {
        setRevisionMessage(error instanceof Error ? error.message : "调整失败，请重试。");
        void bootstrap(); // 失败也对齐一次快照，避免流与实体脱节
        return false;
      } finally {
        source.close();
        setSubmittingRevision(false);
      }
    },
    [bootstrap, openStream, requestId, submittingRevision],
  );

  return { state, submitRevision, submittingRevision, revisionMessage };
}
