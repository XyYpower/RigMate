import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Alpha 自测反馈修复（2026-10-16）：输入"2"——
// ① 同步路径 400 返回英文 Zod issues JSON（已改友好中文）；
// ② async 路径 ZodError 在 onStarted 之前抛出 → started 永不 resolve → HTTP 请求永远挂起（已修：失败传给 started）。

const tempDir = mkdtempSync(join(tmpdir(), "rigmate-design-route-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "route.db");

const { POST } = await import("@/app/api/design/route");

afterAll(async () => {
  const { closeDatabase } = await import("@/infra/db/client");
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

function postRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/design", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/design 输入校验（Alpha 反馈）", () => {
  it("同步路径：太短输入 → 400 + 友好中文（不是英文 issues JSON）", async () => {
    const response = await POST(postRequest({ rawInput: "2" }));
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("太短");
    expect(data.error).not.toContain("ZodError");
    expect(data.error).not.toContain("too_small");
  });

  it("async 路径：太短输入 → 立即 400（不挂起请求）", async () => {
    const response = await POST(postRequest({ rawInput: "2", async: true }));
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("太短");
  }, 10000);

  it("合法输入 async：201 返回 requestId（生成继续）", async () => {
    const response = await POST(postRequest({ rawInput: "预算 9000，办公和网课用，安静一点", async: true }));
    expect(response.status).toBe(201);
    const data = (await response.json()) as { requestId?: string };
    expect(data.requestId).toBeTruthy();
  }, 15000);
});
