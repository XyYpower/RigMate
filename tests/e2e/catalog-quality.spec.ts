import { test, expect } from "@playwright/test";

test("M36 数据质量只读报表：质量状态、队列计数与关键字段完整率可见", async ({ page }) => {
  await page.goto("/hardware");

  await expect(page.getByRole("heading", { name: "数据质量" })).toBeVisible();
  await expect(page.getByText("已核验", { exact: true })).toBeVisible();
  await expect(page.getByText("有参考资料", { exact: true })).toBeVisible();
  await expect(page.getByText(/来源冲突（[\d.]+%）/)).toBeVisible();
  await expect(page.getByText(/来源过期（[\d.]+%）/)).toBeVisible();
  await expect(page.getByText(/待审核（新品 \d+ · 缺字段 \d+ · 冲突 \d+ · 过期 \d+）/)).toBeVisible();

  const qualityTable = page.getByRole("table").nth(1);
  await expect(qualityTable.getByRole("columnheader", { name: "关键字段完整率" })).toBeVisible();
  await expect(qualityTable.getByRole("columnheader", { name: "条目" })).toBeVisible();
  await expect(page.getByText(/质量状态来自字段级证据链/)).toBeVisible();
});
