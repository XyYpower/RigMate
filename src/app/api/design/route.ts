import { NextResponse } from "next/server";
import { createDesignRequest } from "@/application/design/service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = createDesignRequest(body);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法开始方案生成。" },
      { status: 400 },
    );
  }
}
