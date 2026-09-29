import { NextResponse } from "next/server";
import { createDesignRequest } from "@/application/design/service";
import { listDesignRequests } from "@/infra/db/repositories/design-repository";

/** 方案草稿列表：GET /api/design（方案库生命周期分组用）；POST 创建目标 */
export async function GET() {
  return NextResponse.json({ requests: listDesignRequests(20) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await createDesignRequest(body);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法开始方案生成。" },
      { status: 400 },
    );
  }
}
