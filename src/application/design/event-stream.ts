import { listAgentEventLog } from "@/infra/db/repositories/agent-event-log-repository";
import { subscribeRigEvents } from "@/infra/events/design-event-bus";
import type { RigEnvelope } from "@/contracts/agent-events";

/**
 * 会话事件流（agent-ui-design §4.2，P1）。
 *
 * SSE 语义的 ReadableStream：
 * 1. 先订阅总线并缓冲（消灭「查库与订阅之间」的缝隙），再回放 DB 中 afterSeq 之后的事件；
 * 2. 回放完冲刷缓冲区（按 seq 去重、续接游标），之后实时推送；
 * 3. 见到 run_completed 即终结；连接期间定期发一行 SSE 注释心跳。
 * 断线重连：客户端带 Last-Event-ID（= seq），服务端从 seq+1 续传。
 */

const HEARTBEAT_MS = 15_000;

function sseFrame(envelope: RigEnvelope): string {
  return `id: ${envelope.seq}\nevent: rig\ndata: ${JSON.stringify(envelope)}\n\n`;
}

export function createDesignEventStream(
  requestId: string,
  options: { afterSeq?: number; signal?: AbortSignal; heartbeatMs?: number } = {},
): ReadableStream<Uint8Array> {
  const afterSeq = Math.max(0, Math.floor(options.afterSeq ?? 0));
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const encoder = new TextEncoder();

  // 清理句柄提升到外层：正常终结（run_completed）与下游 cancel/abort 都要走同一份
  let cleanup: () => void = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSeq = afterSeq;
      let replaying = true;
      const pending: RigEnvelope[] = [];
      let finished = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const unsubscribe = subscribeRigEvents(requestId, (envelope) => {
        if (replaying) {
          pending.push(envelope);
          return;
        }
        write(envelope);
      });

      cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        unsubscribe();
      };

      if (options.signal) {
        options.signal.addEventListener("abort", () => finish(), { once: true });
      }
      heartbeat = setInterval(() => {
        if (!finished) controller.enqueue(encoder.encode(": ping\n\n"));
      }, heartbeatMs);

      function write(envelope: RigEnvelope): void {
        if (finished) return;
        if (envelope.seq <= lastSeq) {
          if (envelope.payload.type === "run_completed") finish();
          return;
        }
        lastSeq = envelope.seq;
        controller.enqueue(encoder.encode(sseFrame(envelope)));
        if (envelope.payload.type === "run_completed") finish();
      }

      function finish(): void {
        if (finished) return;
        finished = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // 下游已 cancel 时 close 会抛：清理已完成，忽略
        }
      }

      // 回放 → 冲刷缓冲 → 实时。订阅先于查询，缝隙期间的事件在缓冲里按 seq 去重
      try {
        for (const envelope of listAgentEventLog(requestId, lastSeq)) {
          write(envelope);
          if (finished) return;
        }
        replaying = false;
        for (const envelope of pending.sort((a, b) => a.seq - b.seq)) {
          write(envelope);
          if (finished) return;
        }
        pending.length = 0;
      } catch (error) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`),
        );
        finish();
      }
    },
    cancel() {
      cleanup();
    },
  });
}
