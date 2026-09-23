import { test, expect } from "@playwright/test";

test("M24 报告：运行检查后报告带图框标题栏、清单与诊断条款", async ({ page }) => {
  await page.goto("/diy");

  // 建项目：CPU(AM5) + 主板(LGA1700) → 制造一个阻断
  await page.getByRole("textbox", { name: "新项目名称" }).fill("报告测试项目");
  await page.getByRole("button", { name: /新建项目/ }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("AMD 9800X3D");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则" }).fill("AM5");
  await page.getByRole("button", { name: /加入清单/ }).click();
  await expect(page.getByText("1 / 8 类")).toBeVisible();
  await page.getByRole("tablist", { name: "配件类别" }).getByRole("button", { name: "主板" }).click();
  await page.getByRole("textbox", { name: "型号或商品名称" }).fill("测试主板");
  await page.getByRole("textbox", { name: "插槽 用于第一项规则", exact: true }).fill("LGA1700");
  await page.getByRole("button", { name: /加入清单/ }).click();
  await expect(page.getByText("2 / 8 类")).toBeVisible();

  // 运行检查 → 工作台出现"查看报告"入口
  await page.getByRole("button", { name: /运行兼容性检查/ }).click();
  await expect(page.getByRole("link", { name: /查看报告/ })).toBeVisible();

  // 打开报告：图框 + 摘要 + 条款（含阻断）+ 打印按钮
  await page.getByRole("link", { name: /查看报告/ }).click();
  await expect(page.getByText("装机方案检查报告")).toBeVisible();
  await expect(page.getByRole("heading", { name: "报告测试项目" })).toBeVisible();
  await expect(page.getByText("R-CPU-MB-001")).toBeVisible();
  await expect(page.getByRole("button", { name: /打印/ })).toBeVisible();
  await expect(page.getByText("BuildCores OpenDB（ODC-By 1.0）")).toBeVisible();
});

test("M24 报告：未运行检查时给出诚实提示而非空报告", async ({ page, request }) => {
  const res = await request.post("/api/builds", { data: { name: "报告空态项目" } });
  expect(res.status()).toBe(201);
  const { build } = await res.json();

  await page.goto(`/builds/${build.id}/report`);
  await expect(page.getByText("装机方案检查报告")).toBeVisible();
  await expect(page.getByText("尚未运行兼容性检查", { exact: true })).toBeVisible();
  await expect(page.getByText("清单为空。")).toBeVisible();
});
