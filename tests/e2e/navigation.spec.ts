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
  await expect(page.getByText(/导入审计 · \d+ 条/)).toBeVisible();

  // 硬件中心检索：命中人工目录条目并显示来源标记
  await page.getByRole("combobox", { name: "检索类别" }).selectOption("storage");
  await page.getByRole("textbox", { name: "目录关键词" }).fill("速虎");
  await page.getByRole("button", { name: "检索" }).click();
  await expect(page.getByText("金泰克 速虎TP5000 1T PCIE4.0")).toBeVisible();
  const hitRow = page.getByRole("row", { name: /速虎TP5000/ });
  await expect(hitRow.getByText("人工", { exact: true })).toBeVisible();
  // 规格列必须是人话摘要，不是 JSON 甩脸
  await expect(hitRow.locator("td").nth(2)).not.toContainText('{"');

  // 证据台账仍是占位页
  await nav.getByRole("link", { name: /证据台账/ }).click();
  await expect(page.getByRole("heading", { name: "证据台账" })).toBeVisible();

  // 回工作台一切正常
  await nav.getByRole("link", { name: "装机配置" }).click();
  await expect(page.getByRole("heading", { name: "清单", level: 3 })).toBeVisible();
});

test("M22 方案库：新建项目后出现在列表，打开可回工作台载入", async ({ page }) => {
  await page.goto("/");

  // 工作台创建一个项目并加一件配件（电源：额定功率 750W）
  await page.getByRole("textbox", { name: "新项目名称" }).fill("方案库往返测试");
  await page.getByRole("button", { name: /新建项目/ }).click();
  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "电源" }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("测试电源");
  await page.getByRole("textbox", { name: /额定功率/ }).fill("750");
  await page.getByRole("button", { name: /加入清单/ }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();

  // 方案库列表出现该项目
  await page.getByRole("navigation").getByRole("link", { name: "方案库" }).click();
  await expect(page.getByRole("heading", { name: "方案库" })).toBeVisible();
  const row = page.getByRole("row", { name: /方案库往返测试/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("1", { exact: true })).toBeVisible();

  // 打开 → 回工作台且载入该项目
  await row.getByRole("link", { name: "打开" }).click();
  await expect(page.getByRole("heading", { name: "方案库往返测试" })).toBeVisible();
  await expect(page.getByText("1 / 8 类")).toBeVisible();
  await expect(page.getByText(/已从方案库打开/)).toBeVisible();
});
