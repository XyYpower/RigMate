import { test, expect } from "@playwright/test";

test("M27 产品导航：目标入口、方案库、高级 DIY 与资料区可达", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "开始配置" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "我的方案" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "高级 DIY" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "硬件资料" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "价格证据" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "你想配置一台什么样的电脑？" })).toBeVisible();
  await nav.getByRole("link", { name: "高级 DIY" }).click();
  await expect(page.getByRole("heading", { name: /配件录入|编辑配件/ })).toBeVisible();

  await nav.getByRole("link", { name: "硬件资料" }).click();
  await expect(page.getByRole("heading", { name: "硬件中心" })).toBeVisible();

  await nav.getByRole("link", { name: "价格证据" }).click();
  await expect(page.getByRole("heading", { name: "证据台账" })).toBeVisible();
});

test("M34 硬件资料：先理解类别，再检索具体型号", async ({ page }) => {
  await page.goto("/hardware");
  await expect(page.getByText("处理器负责运行程序和游戏逻辑")).toBeVisible();
  await expect(page.getByRole("tab", { name: "显卡" })).toBeVisible();
  await page.getByRole("tab", { name: "显卡" }).click();
  await expect(page.getByText("显卡负责画面渲染、游戏帧率和部分视频编码")).toBeVisible();

  await page.getByRole("textbox", { name: "目录关键词" }).fill("不存在的型号");
  await page.getByRole("button", { name: "检索" }).click();
  await expect(page.getByText("没有找到已核实的型号")).toBeVisible();
});

test("M25 整机复核：粘贴配置单解析成行，创建项目并出报告", async ({ page }) => {
  await page.goto("/projects");

  const pasteText = [
    "CPU：AMD 锐龙7 9800X3D 8核16线程 散片",
    "主板：技嘉 B650M 迫击炮",
    "总价 19999",
  ].join("\n");
  await page.getByRole("textbox", { name: "复核配置单" }).fill(pasteText);
  await page.getByRole("textbox", { name: "复核项目名称" }).fill("M25 复核测试");
  await page.getByRole("button", { name: "解析配置单" }).click();

  await expect(page.getByRole("row", { name: /9800X3D/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /B650M 迫击炮/ })).toBeVisible();
  await expect(page.getByText(/另跳过 1 行/)).toBeVisible();

  await page.getByRole("button", { name: /创建项目并运行检查/ }).click();
  await expect(page.getByText("装机方案检查报告")).toBeVisible();
  await expect(page.getByRole("heading", { name: "M25 复核测试" })).toBeVisible();
});
