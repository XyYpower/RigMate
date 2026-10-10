/**
 * E2E 全局预热：dev 模式下首次完整生成会初始化整条管线
 * （编排器/仓储/规则引擎），实测第一次 4–10s、之后稳定 0.2–0.4s；
 * /design/[id] 首次编译实测 >10s。默认 5s 断言窗口会被打穿
 * （2026-10-10 实证，M27/M31/M35 间歇性失败）。
 *
 * 这里在所有测试前用**完整目标**（不能是 needs_input 早退文案，否则暖不到
 * 生成管线）循环预热 POST /api/design 直到稳定变快（≤800ms），再用返回的
 * 方案 id 预热 /design/[id]。预热请求/数据对测试无害
 * （每次 webServer 启动前 reset-e2e-db 都会重置并种 fixture）。
 */
const WARMUP_GOAL = { rawInput: "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏" };

export default async function globalSetup(): Promise<void> {
  const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
  await fetch(`${base}/`).catch(() => undefined);

  let designId: string | undefined;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const startedAt = Date.now();
    const response = await fetch(`${base}/api/design`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(WARMUP_GOAL),
    }).catch(() => undefined);
    const elapsed = Date.now() - startedAt;
    if (!response?.ok) continue;
    const data = (await response.json().catch(() => undefined)) as
      | { result?: { request?: { id?: string } } }
      | undefined;
    designId ??= data?.result?.request?.id;
    if (elapsed <= 800 && designId) break;
  }

  if (designId) {
    await fetch(`${base}/design/${designId}`).catch(() => undefined);
  }
}
