import { expect, test } from "@playwright/test";

async function waitUntilLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.innerText.includes("正在加载"));
}

test("DIY 清单可以检查 CPU 与主板插槽冲突", async ({ page }) => {
  await page.goto("/");
  await waitUntilLoaded(page);
  await page.getByRole("button", { name: "新建项目 →" }).click();

  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("AMD Ryzen 7 7800X3D");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "主板" }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("MSI B650M MORTAR WIFI");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("LGA1700");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("2 / 8 类")).toBeVisible();

  await page.getByRole("button", { name: "运行兼容性检查 ↗" }).click();

  await expect(page.getByText("CPU 插槽 AM5 与主板插槽 LGA1700 不匹配。")).toBeVisible();
  await expect(page.getByText("R-CPU-MB-001")).toBeVisible();
  await expect(page.getByText("阻断 1", { exact: true })).toBeVisible();
});

test("DIY 清单可以检查内存代际冲突", async ({ page }) => {
  await page.goto("/");
  await waitUntilLoaded(page);
  await page.getByRole("button", { name: "新建项目 →" }).click();

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "主板" }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("MSI B650M MORTAR WIFI");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByLabel("内存代际").selectOption("DDR5");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "内存" }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("金士顿 Fury 32GB");
  await page.getByLabel("内存代际").selectOption("DDR4");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("2 / 8 类")).toBeVisible();

  await page.getByRole("button", { name: "运行兼容性检查 ↗" }).click();

  await expect(page.getByText(/内存代际 DDR4 与主板支持的 DDR5 不匹配/)).toBeVisible();
  await expect(page.getByText("R-MB-RAM-001")).toBeVisible();
});

test("刷新页面后项目与配件自动恢复", async ({ page }) => {
  await page.goto("/");
  await waitUntilLoaded(page);
  await page.getByRole("button", { name: "新建项目 →" }).click();

  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("AMD Ryzen 7 7800X3D");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();

  await page.reload();
  await waitUntilLoaded(page);

  await expect(page.getByText("1 / 8 类")).toBeVisible();
  // 机器画布的悬浮提示会包含同文案，用精确匹配锁定清单行内的型号
  await expect(page.getByText("AMD Ryzen 7 7800X3D", { exact: true })).toBeVisible();
  await expect(page.getByText("已恢复最近的项目")).toBeVisible();
});

test("切换配件类别时草稿按类别隔离", async ({ page }) => {
  await page.goto("/");
  await waitUntilLoaded(page);
  await page.getByRole("button", { name: "新建项目 →" }).click();

  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("AMD Ryzen 7 7800X3D");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "主板" }).click();

  await expect(page.getByRole("textbox", { name: "型号或商品名称" })).toHaveValue("");

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "CPU" }).click();

  await expect(page.getByRole("textbox", { name: "插槽 用于第一项规则" })).toHaveValue("AM5");
  await expect(page.getByRole("textbox", { name: "型号或商品名称" })).toHaveValue(
    "AMD Ryzen 7 7800X3D",
  );
});

test("上一个配件加入后，下一个配件的表单从空白开始", async ({ page }) => {
  await page.goto("/");
  await waitUntilLoaded(page);
  await page.getByRole("button", { name: "新建项目 →" }).click();

  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("AMD Ryzen 7 7800X3D");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "主板" }).click();

  await expect(page.getByRole("textbox", { name: "型号或商品名称" })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "插槽 用于第一项规则" })).toHaveValue("");
});

test("刷新后恢复检查结果，配件变化后提示过期，可删除项目", async ({ page }) => {
  await page.goto("/");
  await waitUntilLoaded(page);
  await page.getByRole("button", { name: "新建项目 →" }).click();

  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("AMD Ryzen 7 7800X3D");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "主板" }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("ROG B650");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("2 / 8 类")).toBeVisible();

  await page.getByRole("button", { name: "运行兼容性检查 ↗" }).click();
  await expect(page.getByText("通过 1", { exact: true })).toBeVisible();

  await page.reload();
  await waitUntilLoaded(page);
  await expect(page.getByText("CPU 与主板都使用 AM5 插槽，基础插槽匹配。")).toBeVisible();
  await expect(page.getByText(/结果时间：/)).toBeVisible();
  await expect(page.getByText(/清单在这次检查之后发生过变化/)).toHaveCount(0);

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "内存" }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("金士顿 Fury 16G");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText(/清单在这次检查之后发生过变化/)).toBeVisible();

  await page.reload();
  await waitUntilLoaded(page);
  await expect(page.getByText(/清单在这次检查之后发生过变化/)).toBeVisible();

  const historySelect = page.getByRole("combobox", { name: /历史项目/ });
  const beforeCount = await historySelect.locator("option").count();

  await page.getByRole("button", { name: "删除当前项目 ✕" }).click();
  await page.getByRole("button", { name: /确认删除「.+」？再点一次 ✕/ }).click();
  await expect(page.getByText(/项目已删除/)).toBeVisible();

  const afterCount = await historySelect.locator("option").count();
  expect(afterCount).toBe(beforeCount - 1);

  await page.reload();
  await waitUntilLoaded(page);
  const reloadedCount = await page
    .getByRole("combobox", { name: /历史项目/ })
    .locator("option")
    .count();
  expect(reloadedCount).toBe(afterCount);
});

test("预算余量计：价格录入、未计价件与差额显示", async ({ page }) => {
  await page.goto("/");
  await waitUntilLoaded(page);
  await page.getByRole("textbox", { name: "预算（元）· 可选，用于余量计" }).fill("8000");
  await page.getByRole("button", { name: "新建项目 →" }).click();

  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("AMD Ryzen 7 9800X3D");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByRole("textbox", { name: "价格（元）· 可选" }).fill("2899");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "机箱" }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("先马 平头哥 M2");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("2 / 8 类")).toBeVisible();

  await expect(page.getByText("¥2,899").first()).toBeVisible();
  await expect(page.getByText(/未计价 1 件/)).toBeVisible();
  await expect(page.getByText("¥5,101")).toBeVisible();

  await page.reload();
  await waitUntilLoaded(page);
  await expect(page.getByText(/未计价 1 件/)).toBeVisible();
  await expect(page.getByText("¥5,101")).toBeVisible();
});

test("配件可编辑与删除，修改后旧结论标记过期", async ({ page }) => {
  await page.goto("/");
  await waitUntilLoaded(page);
  await page.getByRole("button", { name: "新建项目 →" }).click();

  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("AMD Ryzen 7 7800X3D");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();

  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "主板" }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("MSI B650M MORTAR WIFI");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("LGA1700");
  await page.getByRole("button", { name: "加入清单 ＋" }).click();
  await expect(page.getByText("2 / 8 类")).toBeVisible();

  await page.getByRole("button", { name: "运行兼容性检查 ↗" }).click();
  await expect(page.getByText("阻断 1", { exact: true })).toBeVisible();

  // 编辑主板：LGA1700 → AM5
  const motherboardRow = page.locator(".item-row", { hasText: "MSI B650M MORTAR WIFI" });
  await motherboardRow.getByRole("button", { name: "改", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑配件" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "插槽 用于第一项规则" })).toHaveValue("LGA1700");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByRole("button", { name: "保存修改 ✓" }).click();
  await expect(page.getByText(/清单在这次检查之后发生过变化/)).toBeVisible();

  await page.getByRole("button", { name: "运行兼容性检查 ↗" }).click();
  await expect(page.getByText("通过 1", { exact: true })).toBeVisible();

  // 删除 CPU 配件（两步确认）
  const cpuRow = page.locator(".item-row", { hasText: "AMD Ryzen 7 7800X3D" });
  await cpuRow.getByRole("button", { name: "删", exact: true }).click();
  await cpuRow.getByRole("button", { name: "确认删", exact: true }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();
  await expect(page.getByText(/清单在这次检查之后发生过变化/)).toBeVisible();

  await page.reload();
  await waitUntilLoaded(page);
  await expect(page.getByText("1 / 8 类")).toBeVisible();
  await expect(page.getByText("MSI B650M MORTAR WIFI", { exact: true })).toBeVisible();
});
