import { NextResponse } from "next/server";
import { createBuild, listBuilds } from "@/application/builds/service";

export async function GET() {
  return NextResponse.json({ builds: listBuilds() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ build: createBuild(body) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "项目名称不能为空。" }, { status: 400 });
  }
}
