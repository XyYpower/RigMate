import { NextResponse } from "next/server";
import { getDesignResult } from "@/application/design/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const result = getDesignResult(id);
  if (!result) return NextResponse.json({ error: "找不到该方案请求。" }, { status: 404 });
  return NextResponse.json({ result });
}
