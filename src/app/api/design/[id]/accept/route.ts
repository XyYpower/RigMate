import { NextResponse } from "next/server";
import { acceptDesignProposal } from "@/application/design/service";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const body = await _request.json().catch(() => ({}));
    const result = acceptDesignProposal(id, body.allowConflicts === true);
    return NextResponse.json({ buildId: result.buildId, build: result.build });
  } catch (error) {
    if (error instanceof Error && error.message === "PROPOSAL_NOT_FOUND") {
      return NextResponse.json({ error: "找不到该方案草稿。" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "PROPOSAL_HAS_CONFLICT") {
      return NextResponse.json({ error: "方案存在兼容冲突，请先在 DIY 中调整后重新检查。" }, { status: 409 });
    }
    return NextResponse.json({ error: "接受方案失败，请重试。" }, { status: 500 });
  }
}
