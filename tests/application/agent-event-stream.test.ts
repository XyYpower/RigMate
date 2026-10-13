import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RigEnvelope } from "@/contracts/agent-events";

// 会话事件流回归（agent-ui P1）：创建/修订落富事件日志（seq 连续）+ SSE 回放与 Last-Event-ID 续传 + 总线实时推送。
// 临时库先种 fixture 池，否则质量门后没有候选，属诚实空态。
const tempDir = mkdtempSync(join(tmpdir(), "rigmate-agent-event-stream-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "stream.db");
delete process.env.RIGMATE_LLM_API_KEY;

const { seedCatalogFixtureIntoDb } = await import("@/infra/catalog-import/fixture");
seedCatalogFixtureIntoDb();

const service = await import("@/application/design/service");
const { createDesignEventStream } = await import("@/application/design/event-stream");
const {
  listAgentEventLog,
  appendAgentEventLogEntry,
} = await import("@/infra/db/repositories/agent-event-log-repository");
const { publishRigEvent } = await import("@/infra/events/design-event-bus");
const { closeDatabase } = await import("@/infra/db/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

type SseFrame = { id: string; event: string; data: string };

function parseSseFrames(text: string): SseFrame[] {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith(":"))
    .map((block) => {
      const lines = block.split("\n");
      const id = lines.find((line) => line.startsWith("id: "))?.slice("id: ".length) ?? "";
      const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length) ?? "";
      const data = lines.find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? "";
      return { id, event, data };
    });
}

/** 读到流关闭为止（run_completed 会终结流；deadline 只作兜底防挂死） */
async function readAllStream(stream: ReadableStream<Uint8Array>, deadlineMs = 10_000): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (Date.now() > deadline) break;
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  void reader.cancel().catch(() => {});
  return text;
}

describe("会话事件流（agent-ui P1）", () => {
  it("创建方案：富事件实时落库，seq 从 1 连续递增，终态 run_completed", async () => {
    const result = await service.createDesignRequest({ rawInput: "2 万预算，白色海景房，剪辑和游戏" });
    const requestId = result.request.id;
    const log = listAgentEventLog(requestId);

    expect(log.length).toBeGreaterThan(10);
    log.forEach((envelope, index) => expect(envelope.seq).toBe(index + 1));
    expect(log[0]!.payload.type).toBe("user_message");
    expect(log[1]!.payload.type).toBe("run_started");
    expect(log.at(-1)!.payload.type).toBe("run_completed");
    expect(log.at(-1)!.payload).toMatchObject({ status: "ok" });
    // 逐类目检索块（8 类）+ 主链汇总里还会合并一条同名 searchCatalog
    const catalogCalls = log.filter(
      (envelope) => envelope.payload.type === "tool_call" && envelope.payload.tool === "searchCatalog",
    );
    expect(catalogCalls.length).toBeGreaterThanOrEqual(8);
    expect(log.some((envelope) => envelope.payload.type === "phase" && envelope.payload.phase === "retrieved")).toBe(true);
    expect(log.some((envelope) => envelope.payload.type === "proposal")).toBe(true);
    // 无 LLM：模型调用不留痕，只有规则路径
    expect(log.some((envelope) => envelope.payload.type === "tool_call" && envelope.payload.tool === "parse_intent")).toBe(false);
  });

  it("SSE 回放与 Last-Event-ID 续传：完整回放以 run_completed 终结，afterSeq 游标续传", async () => {
    const result = await service.createDesignRequest({ rawInput: "8000 预算，网游主机" });
    const requestId = result.request.id;

    const full = parseSseFrames(await readAllStream(createDesignEventStream(requestId)));
    expect(full[0]!.id).toBe("1");
    expect(full[0]!.event).toBe("rig");
    const lastPayload = JSON.parse(full.at(-1)!.data) as RigEnvelope;
    expect(lastPayload.payload.type).toBe("run_completed");

    const resumed = parseSseFrames(await readAllStream(createDesignEventStream(requestId, { afterSeq: 3 })));
    expect(resumed.length).toBe(full.length - 3);
    expect(resumed[0]!.id).toBe("4");
  });

  it("总线实时推送：回放后保持连接，publish 的事件实时到达并以 run_completed 收口", async () => {
    // 手工构造一个「进行中」的会话（历史无 run_completed）：流回放后必须保持打开
    const { saveDesignRequest } = await import("@/infra/db/repositories/design-repository");
    const requestId = crypto.randomUUID();
    const at = new Date().toISOString();
    saveDesignRequest({
      id: requestId,
      rawInput: "实时推送测试",
      intent: { budgetCents: null, useCases: [], appearance: [], existingParts: [], constraints: [], region: "中国大陆" },
      status: "generating",
      createdAt: at,
      updatedAt: at,
    });
    const runId = "run-live-test";
    const envelope = (seq: number, payload: RigEnvelope["payload"]): RigEnvelope => ({
      id: `evt-live-${seq}`, seq, requestId, runId, at, payload,
    });
    appendAgentEventLogEntry(envelope(1, { type: "user_message", runId, text: "实时推送测试" }));
    appendAgentEventLogEntry(envelope(2, { type: "phase", runId, phase: "understanding", message: "手工追加的历史事件" }));

    const collection = readAllStream(createDesignEventStream(requestId, { heartbeatMs: 20 }));
    publishRigEvent(envelope(3, { type: "phase", runId, phase: "retrieved", message: "实时推送一" }));
    publishRigEvent(envelope(4, { type: "run_completed", runId, status: "ok" }));

    const frames = parseSseFrames(await collection);
    expect(frames.map((frame) => frame.id)).toEqual(["1", "2", "3", "4"]);
    expect(frames.some((frame) => frame.data.includes("实时推送一"))).toBe(true);
    expect(JSON.parse(frames.at(-1)!.data).payload.type).toBe("run_completed");
  });

  it("修订：新 run 的事件续接同一 seq 序列，user_message 与 run_completed 都在", async () => {
    const result = await service.createDesignRequest({ rawInput: "1 万预算，紧凑机箱，网游" });
    const requestId = result.request.id;
    const before = listAgentEventLog(requestId);

    await service.reviseDesign(requestId, { instruction: "预算降到 9000" });

    const after = listAgentEventLog(requestId);
    expect(after.length).toBeGreaterThan(before.length);
    after.forEach((envelope, index) => expect(envelope.seq).toBe(index + 1));
    expect(
      after.some((envelope) => envelope.payload.type === "user_message" && envelope.payload.text === "预算降到 9000"),
    ).toBe(true);
    expect(after.filter((envelope) => envelope.payload.type === "run_completed").length).toBe(2);
    // 修订 run 的 run_started 晚于第一个 run 的 run_completed
    const completedIndexes = after
      .map((envelope, index) => (envelope.payload.type === "run_completed" ? index : -1))
      .filter((index) => index >= 0);
    expect(completedIndexes.length).toBe(2);
  });
});
