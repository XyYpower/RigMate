import { test, expect } from "@playwright/test";

test("M36 审核台：待复核证据列表可访问并带复核人署名入口", async ({ page }) => {
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "审核台" })).toBeVisible();
  await expect(page.getByLabel("复核人署名")).toBeVisible();
  // E2E 库为空 → 空态文案；有数据时显示分组列表
  await expect(page.getByText(/没有待复核的证据|共 \d+ 条，按产品分组/)).toBeVisible();
});
