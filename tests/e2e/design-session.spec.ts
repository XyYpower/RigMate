import { test, expect } from "@playwright/test";

/**
 * 会话时间线视图（agent-ui P2）：/design/[id] 默认形态。
 * 断言时间线折叠（用户消息 / 工具块 / 方案卡 / 追问）+ 修订续流 + 工作台入口。
 */

async function createDesignViaApi(page: import("@playwright/test").Page, rawInput: string): Promise<string> {
  const response = await page.request.post("/api/design", { data: { rawInput } });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.result.request.id as string;
}

test("会话时间线：生成事件折叠成流，方案卡可接受进入 DIY", async ({ page }) => {
  const designId = await createDesignViaApi(page, "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏");
  await page.goto(`/design/${designId}`);
  await page.waitForLoadState("domcontentloaded");

  // 用户消息在最前；时间线有工具块（逐类目检索目录 ≥8 + 主链汇总一条）
  await expect(page.locator(".session-user-text").first()).toContainText("2 万预算");
  const card = page.locator(".session-proposal-card");
  await expect(card).toBeVisible();
  const catalogBlocks = await page.locator(".session-tool-label").filter({ hasText: "检索目录" }).count();
  expect(catalogBlocks).toBeGreaterThanOrEqual(8);
  await expect(page.locator(".session-tool-label").filter({ hasText: "兼容性检查" })).toBeVisible();

  // 方案卡：标题 / 版本 / 预算标尺 / 配件行 / 动作
  await expect(card.locator(".session-proposal-version")).toContainText("方案 v1");
  await expect(card.locator(".budget-ruler")).toContainText("预算 ¥20,000");
  await expect(card.locator(".session-proposal-parts li")).toHaveCount(8);
  const accept = card.getByRole("button", { name: "接受这一版" });
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page).toHaveURL(/\/diy\?project=[0-9a-f-]+/);
});

test("会话时间线：信息不足时给出追问卡片与补充入口", async ({ page }) => {
  const designId = await createDesignViaApi(page, "帮我配一台电脑");
  await page.goto(`/design/${designId}`);
  await page.waitForLoadState("domcontentloaded");

  await expect(page.locator(".session-question-text").first()).toContainText(/缺少预算或用途/);
  await expect(page.locator(".session-needs-input")).toBeVisible();
});

test("会话时间线：修订输入提交后续流生成第 2 版方案卡", async ({ page }) => {
  const designId = await createDesignViaApi(page, "2 万预算，白色海景房，剪辑和游戏");
  await page.goto(`/design/${designId}`);
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".session-proposal-card").first()).toBeVisible();

  const composer = page.getByRole("textbox", { name: "继续调整这套方案" });
  await composer.fill("预算压到 4000");
  await page.getByRole("button", { name: "提交修改" }).click();

  // 第 2 轮 divider 出现 + 新方案卡 v2（预算跌破档位线）
  await expect(page.locator(".session-run-divider").filter({ hasText: "第 2 轮" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".session-proposal-version").filter({ hasText: "方案 v2" })).toBeVisible({ timeout: 20_000 });
  // 修订指令作为用户消息进入时间线
  await expect(page.locator(".session-user-text").filter({ hasText: "预算压到 4000" })).toBeVisible();
});

test("会话时间线：方案卡可跳转完整工作台", async ({ page }) => {
  const designId = await createDesignViaApi(page, "8000 预算，玩游戏");
  await page.goto(`/design/${designId}`);
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".session-proposal-card").first()).toBeVisible();

  await page.locator(".session-workbench-link").first().click();
  await expect(page).toHaveURL(/\?view=workbench/);
  await expect(page.getByRole("heading", { name: "核验台" })).toBeVisible();
});
