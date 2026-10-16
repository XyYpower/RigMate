import { NextResponse } from "next/server";
import { z } from "zod";
import { createDesignRequest } from "@/application/design/service";
import { listDesignRequests } from "@/infra/db/repositories/design-repository";
import { llmAdmission } from "@/infra/llm/admission";

/** 校验类失败 → 用户能看懂的一句话（ZodError.message 是英文 issues JSON，绝不透传） */
function friendlyDesignError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (issue?.path.includes("rawInput")) {
      return "目标描述太短了，多写几个字——比如「预算 8000，办公和网课用」。";
    }
    return "输入格式不对，请检查后重试。";
  }
  return error instanceof Error ? error.message : "无法开始方案生成。";
}

/** 方案草稿列表：GET /api/design（方案库生命周期分组用）；POST 创建目标 */
export async function GET() {
  return NextResponse.json({ requests: listDesignRequests(20) });
}

export async function POST(request: Request) {
  // 域封闭第 3 层（agent-ui P4）：LLM 携带型入口先过准入（并发 + 窗口限频），防刷在碰模型之前
  const admission = llmAdmission().admit(request.headers.get("x-forwarded-for") ?? "local");
  if (!admission.ok) {
    return NextResponse.json(
      { error: "方案生成请求太频繁，请稍等几秒再试。" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(admission.retryAfterMs / 1000)) } },
    );
  }
  try {
    const body = await request.json();
    // async 模式（agent-ui P3）：请求行落库后立即返回 requestId，生成在后台继续，
    // 前端拿 id 跳会话页用 SSE 看过程；默认仍是同步返回完整结果（兼容既有调用方）
    if ((body as { async?: boolean } | null)?.async === true) {
      let resolveStarted!: (requestId: string) => void;
      let rejectStarted!: (error: unknown) => void;
      const started = new Promise<string>((resolve, reject) => {
        resolveStarted = resolve;
        rejectStarted = reject;
      });
      // 输入非法时后台 promise 立即失败：必须把失败传给 started，否则 HTTP 请求永远挂起
      // （Alpha 实测：输入"2"→ ZodError 在 onStarted 之前抛出 → 浏览器无限等待）
      void createDesignRequest(body, { onStarted: resolveStarted })
        .catch((error) => {
          console.error("[api/design] 后台生成失败：", error);
          rejectStarted(error);
        })
        .finally(() => admission.ticket.release());
      const requestId = await started;
      return NextResponse.json({ requestId }, { status: 201 });
    }
    const result = await createDesignRequest(body);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: friendlyDesignError(error) }, { status: 400 });
  } finally {
    admission.ticket.release();
  }
}
