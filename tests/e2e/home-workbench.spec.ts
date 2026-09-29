import { test, expect } from "@playwright/test";

/**
 * home-workbench（Codex 计划 Task 3 专项 E2E，此前遗漏）：
 * 有效提交跳转方案页；非法预算不发请求、反馈就近且不丢输入。
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

  await page.getByRole("button", { name: /生成装机方案/ }).click();

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
  await page.getByRole("button", { name: /生成装机方案/ }).click();
  const request = await designRequest;
  expect((request!.postDataJSON() as { budgetCents?: number }).budgetCents).toBe(2_000_000);
});

test("首页：右栏展示工作方式与最近方案入口", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "RigMate 怎么工作" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近的方案" })).toBeVisible();
  await page.getByRole("link", { name: /全部/ }).click();
  await expect(page).toHaveURL(/\/projects/);
});
