import { test, expect } from "@playwright/test";

/**
 * home-workbench（首页专项 E2E，agent-ui 重设计后更新）：
 * 首页 = 会话起点（居中输入框主角）：有效提交跳会话页看 agent 全程；
 * 非法预算不发请求、反馈就近且不丢输入；最近方案为安静次级入口。
 */

test("首页：会话起点居中呈现，提交直达会话页看 agent 全程", async ({ page }) => {
  await page.goto("/");

  // 会话起点：目标输入自动聚焦（唯一输入），示例词条在
  const editor = page.getByRole("textbox", { name: "描述你的装机目标" });
  await expect(editor).toBeFocused();
  await expect(page.getByLabel("示例目标").getByRole("button")).toHaveCount(3);

  // 异步创建：一句话提交，缺预算时 agent 在时间线上追问（渐进式澄清）
  await editor.fill("主要玩 2K 游戏");
  await page.getByRole("button", { name: /开始搭配/ }).click();
  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await expect(page.locator(".session-question-text").first()).toBeVisible({ timeout: 30_000 });
  // 补一句预算，流程继续走到方案卡
  const composer = page.getByRole("textbox", { name: "补充你的装机目标" });
  await composer.fill("预算 8000");
  await page.getByRole("button", { name: "重新搭配" }).click();
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
  // 会话列表入口可达（归属我的方案 → AI 会话页签）
  await page.getByRole("link", { name: /全部 AI 会话/ }).click();
  await expect(page).toHaveURL(/\/projects\?tab=sessions$/);
});
