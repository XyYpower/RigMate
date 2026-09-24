import { NextResponse } from "next/server";
import { buildIdSchema, getCheckHistory } from "@/application/builds/service";

type BuildCheckRouteContext = { params: Promise<{ id: string }> };

/** 检查历史时间线：GET /api/builds/[id]/check/history（M33） */
export async function GET(_request: Request, context: BuildCheckRouteContext) {
  const { id } = await context.params;
  if (!buildIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "无效的项目 ID。" }, { status: 400 });
  }
  try {
    return NextResponse.json({ runs: getCheckHistory(id) });
  } catch (error) {
    if (error instanceof Error && error.message === "BUILD_NOT_FOUND") {
      return NextResponse.json({ error: "找不到项目。" }, { status: 404 });
    }
    return NextResponse.json({ error: "读取检查历史失败。" }, { status: 500 });
  }
}
