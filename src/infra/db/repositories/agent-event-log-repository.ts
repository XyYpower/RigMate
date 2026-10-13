import { and, asc, eq, gt, sql } from "drizzle-orm";
import { agentEventLog, ensureDatabase } from "../client";
import { rigEnvelopeSchema, type RigEnvelope } from "@/contracts/agent-events";

/**
 * 会话事件日志仓储（agent-ui-design §4，P1）。
 *
 * 只追加：每条富事件一行，seq 由调用方按 request 内计数分配。
 * 读取按 seq 升序；afterSeq 支撑 SSE 断线续传（Last-Event-ID 游标）。
 */

export function appendAgentEventLogEntry(envelope: RigEnvelope): void {
  ensureDatabase()
    .insert(agentEventLog)
    .values({
      id: envelope.id,
      requestId: envelope.requestId,
      runId: envelope.runId,
      seq: envelope.seq,
      payload: JSON.stringify(envelope.payload),
      createdAt: envelope.at,
    })
    .run();
}

export function listAgentEventLog(requestId: string, afterSeq = 0): RigEnvelope[] {
  return ensureDatabase()
    .select()
    .from(agentEventLog)
    .where(and(eq(agentEventLog.requestId, requestId), gt(agentEventLog.seq, afterSeq)))
    .orderBy(asc(agentEventLog.seq))
    .all()
    .map((row) =>
      rigEnvelopeSchema.parse({
        id: row.id,
        seq: row.seq,
        requestId: row.requestId,
        runId: row.runId,
        at: row.createdAt,
        payload: JSON.parse(row.payload),
      }),
    );
}

/** 该 request 下一条可用 seq（跨 run 连续；无历史时从 1 起） */
export function nextAgentEventSeq(requestId: string): number {
  const row = ensureDatabase()
    .select({ maxSeq: sql<number>`max(seq)` })
    .from(agentEventLog)
    .where(eq(agentEventLog.requestId, requestId))
    .get();
  return (row?.maxSeq ?? 0) + 1;
}
