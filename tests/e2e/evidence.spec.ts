import { test, expect } from "@playwright/test";

test("M26 证据台账：录入证据出现在台账，可按类别过滤", async ({ page }) => {
  await page.goto("/evidence");

  // 录入一条证据
  await page.getByRole("combobox", { name: "类别" }).selectOption("motherboard");
  await page.getByRole("textbox", { name: "型号 / 商品名" }).fill("技嘉 B650M 小雕");
  await page.getByRole("textbox", { name: "价格（元）" }).fill("1099");
  await page.getByRole("combobox", { name: "价格口径" }).selectOption("到手价");
  await page.getByRole("combobox", { name: "渠道" }).selectOption("京东");
  await page.getByRole("textbox", { name: "店铺" }).fill("京东自营");
  await page.getByRole("button", { name: /记录这条证据/ }).click();

  // 台账出现该条
  const evidenceRow = page.getByRole("row", { name: /技嘉 B650M 小雕/ });
  await expect(evidenceRow).toBeVisible();
  await expect(evidenceRow.getByText("¥1,099")).toBeVisible();
  await expect(evidenceRow.getByText("到手价 · 京东 · 京东自营")).toBeVisible();

  // 按类别过滤：SSD/HDD 下不应看到主板条目
  await page.getByRole("button", { name: "SSD/HDD", exact: true }).click();
  await expect(page.getByRole("row", { name: /技嘉 B650M 小雕/ })).toHaveCount(0);

  // 回全部再见到该条
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.getByRole("row", { name: /技嘉 B650M 小雕/ })).toBeVisible();
});

test("M26 证据台账：非法价格被拒绝且不写库", async ({ page }) => {
  await page.goto("/evidence");
  await page.getByRole("textbox", { name: "型号 / 商品名" }).fill("非法价格条目");
  await page.getByRole("textbox", { name: "价格（元）" }).fill("0");
  await page.getByRole("button", { name: /记录这条证据/ }).click();
  await expect(page.getByText("价格需要是大于 0 的数字（单位：元）。")).toBeVisible();
  await expect(page.getByRole("row", { name: /非法价格条目/ })).toHaveCount(0);
});
