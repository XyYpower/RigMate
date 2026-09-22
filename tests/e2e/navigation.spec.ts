import { test, expect } from "@playwright/test";

test("M22 全局导航：四区可达，硬件中心展示三层目录与审计", async ({ page }) => {
  await page.goto("/");

  // 导航壳可见
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "装机配置" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "硬件中心" })).toBeVisible();

  // 硬件中心：来源三行 + 类别覆盖 + 审计
  await nav.getByRole("link", { name: "硬件中心" }).click();
  await expect(page.getByRole("heading", { name: "硬件中心" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "目录来源" })).toBeVisible();
  await expect(page.getByText("人工种子")).toBeVisible();
  await expect(page.getByText("BuildCores OpenDB").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "导入审计" })).toBeVisible();

  // 硬件中心检索：命中人工目录条目并显示来源标记
  await page.getByRole("combobox", { name: "检索类别" }).selectOption("storage");
  await page.getByRole("textbox", { name: "目录关键词" }).fill("速虎");
  await page.getByRole("button", { name: "检索" }).click();
  await expect(page.getByText("金泰克 速虎TP5000 1T PCIE4.0")).toBeVisible();
  const hitRow = page.getByRole("row", { name: /速虎TP5000/ });
  await expect(hitRow.getByText("人工", { exact: true })).toBeVisible();

  // 未实现区显示占位页
  await nav.getByRole("link", { name: /方案库/ }).click();
  await expect(page.getByRole("heading", { name: "方案库" })).toBeVisible();

  // 回工作台一切正常
  await nav.getByRole("link", { name: "装机配置" }).click();
  await expect(page.getByRole("heading", { name: "清单", level: 3 })).toBeVisible();
});
