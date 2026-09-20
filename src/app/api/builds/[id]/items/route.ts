import { NextResponse } from "next/server";
import { addBuildItem, buildIdSchema, getBuild } from "@/application/builds/service";

type BuildItemsRouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: Request,
  context: BuildItemsRouteContext,
) {
  const { id } = await context.params;
  if (!buildIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "无效的项目 ID。" }, { status: 400 });
  }
  const build = getBuild(id);
  if (!build) return NextResponse.json({ error: "找不到项目。" }, { status: 404 });
  return NextResponse.json({ items: build.items });
}

export async function POST(
  request: Request,
  context: BuildItemsRouteContext,
) {
  const { id } = await context.params;
  if (!buildIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "无效的项目 ID。" }, { status: 400 });
  }
  try {
    const body = await request.json();
    return NextResponse.json({ build: addBuildItem(id, body) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "BUILD_NOT_FOUND") {
      return NextResponse.json({ error: "找不到项目。" }, { status: 404 });
    }
    return NextResponse.json({ error: "配件信息不完整，请检查输入。" }, { status: 400 });
  }
}
