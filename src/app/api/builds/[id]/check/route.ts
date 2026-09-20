import { NextResponse } from "next/server";
import { buildIdSchema, checkBuild, getLatestCheck } from "@/application/builds/service";

type BuildCheckRouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: Request,
  context: BuildCheckRouteContext,
) {
  const { id } = await context.params;
  if (!buildIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "无效的项目 ID。" }, { status: 400 });
  }
  try {
    return NextResponse.json({ check: getLatestCheck(id) });
  } catch (error) {
    if (error instanceof Error && error.message === "BUILD_NOT_FOUND") {
      return NextResponse.json({ error: "找不到项目。" }, { status: 404 });
    }
    return NextResponse.json({ error: "读取检查结果失败。" }, { status: 500 });
  }
}

export async function POST(
  _request: Request,
  context: BuildCheckRouteContext,
) {
  const { id } = await context.params;
  if (!buildIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "无效的项目 ID。" }, { status: 400 });
  }
  try {
    return NextResponse.json(checkBuild(id));
  } catch (error) {
    if (error instanceof Error && error.message === "BUILD_NOT_FOUND") {
      return NextResponse.json({ error: "找不到项目。" }, { status: 404 });
    }
    return NextResponse.json({ error: "检查失败，请稍后重试。" }, { status: 500 });
  }
}
