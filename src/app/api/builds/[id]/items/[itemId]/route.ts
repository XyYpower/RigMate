import { NextResponse } from "next/server";
import { buildIdSchema, deleteBuildItem, updateBuildItem } from "@/application/builds/service";

type BuildItemRouteContext = { params: Promise<{ id: string; itemId: string }> };

function invalidResponse() {
  return NextResponse.json({ error: "无效的项目或配件 ID。" }, { status: 400 });
}

function handleError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "BUILD_NOT_FOUND") {
    return NextResponse.json({ error: "找不到项目。" }, { status: 404 });
  }
  if (error instanceof Error && error.message === "ITEM_NOT_FOUND") {
    return NextResponse.json({ error: "找不到该配件。" }, { status: 404 });
  }
  return NextResponse.json({ error: fallback }, { status: 400 });
}

export async function PATCH(request: Request, context: BuildItemRouteContext) {
  const { id, itemId } = await context.params;
  if (!buildIdSchema.safeParse(id).success || !buildIdSchema.safeParse(itemId).success) {
    return invalidResponse();
  }
  try {
    const body = await request.json();
    return NextResponse.json({ build: updateBuildItem(id, itemId, body) });
  } catch (error) {
    return handleError(error, "配件信息不完整，请检查输入。");
  }
}

export async function DELETE(_request: Request, context: BuildItemRouteContext) {
  const { id, itemId } = await context.params;
  if (!buildIdSchema.safeParse(id).success || !buildIdSchema.safeParse(itemId).success) {
    return invalidResponse();
  }
  try {
    return NextResponse.json({ build: deleteBuildItem(id, itemId) });
  } catch (error) {
    return handleError(error, "删除配件失败。");
  }
}
