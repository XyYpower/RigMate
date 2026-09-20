import { NextResponse } from "next/server";
import { buildIdSchema, deleteBuild, getBuild } from "@/application/builds/service";

type BuildRouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: BuildRouteContext) {
  const { id } = await context.params;
  if (!buildIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "无效的项目 ID。" }, { status: 400 });
  }
  const build = getBuild(id);
  if (!build) return NextResponse.json({ error: "找不到项目。" }, { status: 404 });
  return NextResponse.json({ build });
}

export async function DELETE(_request: Request, context: BuildRouteContext) {
  const { id } = await context.params;
  if (!buildIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "无效的项目 ID。" }, { status: 400 });
  }
  deleteBuild(id);
  return NextResponse.json({ ok: true });
}
