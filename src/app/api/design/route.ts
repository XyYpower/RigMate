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
    // async 模式（agent-ui P3）：请求行落库后立即返回 requestId，生成在后台继续，
    // 前端拿 id 跳会话页用 SSE 看过程；默认仍是同步返回完整结果（兼容既有调用方）
    if ((body as { async?: boolean } | null)?.async === true) {
      let resolveStarted!: (requestId: string) => void;
      const started = new Promise<string>((resolve) => {
        resolveStarted = resolve;
      });
      void createDesignRequest(body, { onStarted: resolveStarted }).catch((error) => {
        console.error("[api/design] 后台生成失败：", error);
      });
      const requestId = await started;
      return NextResponse.json({ requestId }, { status: 201 });
    }
    const result = await createDesignRequest(body);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法开始方案生成。" },
      { status: 400 },
    );
  }
}
