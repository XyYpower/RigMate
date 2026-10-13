import { NextResponse } from "next/server";
import { reviseDesign } from "@/application/design/service";
import { llmAdmission } from "@/infra/llm/admission";

type Context = { params: Promise<{ id: string }> };

/** 自然语言修订方案：POST /api/design/[id]/revisions { instruction } → 新版本方案或诚实追问 */
export async function POST(request: Request, context: Context) {
  // 域封闭第 3 层（agent-ui P4）：LLM 携带型入口先过准入
  const admission = llmAdmission().admit(request.headers.get("x-forwarded-for") ?? "local");
  if (!admission.ok) {
    return NextResponse.json(
      { error: "调整请求太频繁，请稍等几秒再试。" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(admission.retryAfterMs / 1000)) } },
    );
  }
  const { id } = await context.params;
  try {
    const body = await request.json();
    const result = await reviseDesign(id, body);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof Error && error.message === "DESIGN_REQUEST_NOT_FOUND") {
      return NextResponse.json({ error: "找不到该方案请求。" }, { status: 404 });
    }
    return NextResponse.json({ error: "调整失败，请换个说法重试。" }, { status: 400 });
  } finally {
    admission.ticket.release();
  }
}
