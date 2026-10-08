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

test("首页：八类空槽位、预算标尺空态与主按钮可达", async ({ page }) => {
  await page.goto("/");

  // 八类装配槽位按固定顺序展示，空态不填虚构型号
  const rail = page.getByRole("region", { name: "整机装配轨道" });
  await expect(rail.locator(".assembly-slot")).toHaveCount(8);
  await expect(rail.locator(".assembly-slot").first()).toContainText("处理器");
  await expect(rail.locator(".assembly-slot").first()).toContainText("等待目标");
  await expect(rail.locator(".assembly-slot").last()).toContainText("机箱");

  // 预算标尺空态：未设置预算 + 三项真实能力
  await expect(page.locator(".budget-ruler")).toContainText("未设置预算");
  await expect(page.locator(".home-caps")).toContainText("资料核验");
  await expect(page.locator(".home-caps")).toContainText("兼容检查");
  await expect(page.locator(".home-caps")).toContainText("可编辑方案");

  // 主按钮聚焦可达
  const submit = page.getByRole("button", { name: /开始搭配/ });
  await expect(submit).toBeEnabled();
  await submit.focus();
  await expect(submit).toBeFocused();

  // 生成中：真实等待状态 + 槽位转为检索中，不显示伪造百分比
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("8 千预算，主要玩 2K 游戏");
  await submit.click();
  await expect(page.getByRole("status", { name: "方案生成中" })).toBeVisible();
  await expect(page.locator(".assembly-slot").first()).toContainText("检索中");
});

test("首页：最近方案入口保留为次级入口", async ({ page }) => {
  // 空库时也有安静空态；建一个方案后出现在列表并可去方案库
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "最近的方案" })).toBeVisible();

  const design = await page.request.post("/api/design", {
    data: { rawInput: "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏" },
  });
  expect(design.ok()).toBeTruthy();
  const designData = await design.json();
  expect(designData.result.proposal).toBeTruthy();
  const accepted = await page.request.post(`/api/design/${designData.result.proposal.id}/accept`, {
    data: {},
  });
  expect(accepted.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "最近的方案" })).toBeVisible();
  await page.getByRole("link", { name: /全部/ }).click();
  await expect(page).toHaveURL(/\/projects/);
});
