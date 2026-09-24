import { NextResponse } from "next/server";
import { reviseDesign } from "@/application/design/service";

type Context = { params: Promise<{ id: string }> };

/** 自然语言修订方案：POST /api/design/[id]/revisions { instruction } → 新版本方案或诚实追问 */
export async function POST(request: Request, context: Context) {
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
  }
}
