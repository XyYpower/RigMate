import { test, expect } from "@playwright/test";

/**
 * home-workbench（首页专项 E2E，agent-ui 重设计后更新）：
 * 首页 = 会话起点（居中输入框主角）：有效提交跳会话页看 agent 全程；
 * 非法预算不发请求、反馈就近且不丢输入；最近方案为安静次级入口。
 */

test("首页：非法预算不发起方案请求且保留输入", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "描述你的装机目标" });
  await editor.fill("2 万预算，白色海景房，剪辑和游戏");
  await page.getByRole("textbox", { name: "预算（元，可选）" }).fill("-5000");

  const designRequest = page.waitForRequest(
    (request) => request.url().includes("/api/design") && request.method() === "POST",
    { timeout: 3000 },
  ).catch(() => null);

  await page.getByRole("button", { name: /开始搭配/ }).click();

  const posted = await designRequest;
  expect(posted).toBeNull();
  // 反馈就近出现，且目标文本不丢
  await expect(page.getByText(/预算请输入大于 0 的金额/)).toBeVisible();
  await expect(editor).toHaveValue(/白色海景房/);
  await expect(page).toHaveURL(/\/$/);
});

test("首页：预算快捷档一键填入并随提交生效", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("剪辑和游戏主机");
  await page.getByRole("button", { name: "2 万", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "预算（元，可选）" })).toHaveValue("20000");

  const designRequest = page.waitForRequest(
    (request) => request.url().includes("/api/design") && request.method() === "POST",
  );
  await page.getByRole("button", { name: /开始搭配/ }).click();
  const request = await designRequest;
  expect((request!.postDataJSON() as { budgetCents?: number }).budgetCents).toBe(2_000_000);
});

test("首页：会话起点居中呈现，提交直达会话页看 agent 全程", async ({ page }) => {
  await page.goto("/");

  // 会话起点：目标输入自动聚焦，能力徽标与示例词条在
  const editor = page.getByRole("textbox", { name: "描述你的装机目标" });
  await expect(editor).toBeFocused();
  await expect(page.getByRole("list", { name: "能力说明" })).toContainText("资料核验");
  await expect(page.getByRole("list", { name: "能力说明" })).toContainText("兼容检查");
  await expect(page.getByLabel("示例目标").getByRole("button")).toHaveCount(3);

  // 异步创建（P3）：提交立即跳会话页，生成过程在时间线上点亮到方案卡
  await editor.fill("8 千预算，主要玩 2K 游戏");
  await page.getByRole("button", { name: /开始搭配/ }).click();
  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await expect(page.locator(".session-proposal-card")).toBeVisible({ timeout: 30_000 });
});

test("首页：最近方案入口保留为次级入口", async ({ page }) => {
  // 建一个方案并接受后，首页出现安静的最近列表，并可跳全部方案会话
  const design = await page.request.post("/api/design", {
    data: { rawInput: "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏" },
  });
  expect(design.ok()).toBeTruthy();
  const designData = await design.json();
  const accepted = await page.request.post(`/api/design/${designData.result.proposal.id}/accept`, {
    data: {},
  });
  expect(accepted.ok()).toBeTruthy();

  await page.goto("/");
  const recent = page.locator(".home-recent");
  await expect(recent).toBeVisible();
  await expect(recent.getByText("白色").first()).toBeVisible();
  // 会话列表入口可达
  await page.getByRole("link", { name: /全部方案会话/ }).click();
  await expect(page).toHaveURL(/\/design$/);
});
