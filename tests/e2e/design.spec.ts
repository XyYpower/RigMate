import { test, expect } from "@playwright/test";

test("M27 目标驱动主链路：自然语言生成方案、自动校验并接受进入 DIY", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏");
  await page.getByRole("button", { name: "生成装机方案" }).click();

  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await expect(page.getByRole("heading", { name: /视频剪辑 \+ 游戏/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "建议配置" })).toBeVisible();
  await expect(page.getByText("正在检索目录和已核验规格。")).toBeVisible();
  await expect(page.getByText(/主要硬件|资料需要确认|取舍需要留意/).first()).toBeVisible();
  await expect(page.getByText("经验估算，非实时成交价").first()).toBeVisible();

  const accept = page.getByRole("button", { name: "接受方案，进入 DIY" });
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page).toHaveURL(/\/diy\?project=[0-9a-f-]+/);
  await expect(page.getByRole("heading", { name: /视频剪辑 \+ 游戏/ })).toBeVisible();
  await expect(page.getByText(/已从方案库打开|已恢复最近的项目/)).toBeVisible();
});

test("M27 目标信息不足：不硬凑方案而是提出最小追问", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("帮我配一台电脑");
  await page.getByRole("button", { name: "生成装机方案" }).click();

  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await expect(page.getByRole("heading", { name: "还差一点信息" })).toBeVisible();
  await expect(page.getByText(/缺少预算或用途/)).toBeVisible();
});

test("M31 自然语言修订：预算跨档位生成第 2 版并显示差异", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("2 万预算，白色海景房，剪辑和游戏");
  await page.getByRole("button", { name: "生成装机方案" }).click();
  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await expect(page.getByText("方案草稿 · 第 1 版")).toBeVisible();

  await page.getByRole("textbox", { name: "调整方案" }).fill("预算压到 1.2 万");
  await page.getByRole("button", { name: "调整方案" }).click();

  await expect(page.getByText(/已理解调整：预算调整为 12,000 元/)).toBeVisible();
  await expect(page.getByText("方案草稿 · 第 2 版")).toBeVisible();
  await expect(page.getByText(/第 2 版已就绪/)).toBeVisible();
  // 版本差异区：预算跌破档位线，CPU/显卡/电源应出现 旧件→新件 的变化
  const diff = page.locator(".proposal-diff");
  await expect(diff.getByRole("heading", { name: "相对第 1 版的变化" })).toBeVisible();
  await expect(diff).toContainText("4070 SUPER");
  await expect(diff).toContainText("RTX 4060");
});

test("M34 方案主区可直接表达修改并保留版本变化", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("2 万预算，剪辑和游戏");
  await page.getByRole("button", { name: "生成装机方案" }).click();
  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);

  const editor = page.getByRole("textbox", { name: "继续调整方案" });
  await expect(editor).toBeVisible();
  await editor.fill("预算压到 1.2 万");
  await page.getByRole("button", { name: "提交修改" }).click();
  await expect(page.getByText("方案草稿 · 第 2 版")).toBeVisible();
  await expect(page.getByRole("heading", { name: "相对第 1 版的变化" })).toBeVisible();
});

test("M35 可以切换查看历史方案并展开单件依据", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("2 万预算，剪辑和游戏");
  await page.getByRole("button", { name: "生成装机方案" }).click();
  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await page.getByRole("textbox", { name: /继续调整方案/ }).fill("预算压到 1.2 万");
  await page.getByRole("button", { name: /提交修改/ }).click();
  await expect(page.getByText("方案草稿 · 第 2 版")).toBeVisible();

  const versionPicker = page.getByRole("combobox", { name: "方案版本" });
  await expect(versionPicker).toBeVisible();
  await versionPicker.selectOption("1");
  await expect(page.getByText("方案草稿 · 第 1 版")).toBeVisible();
  await expect(page.getByText("当前查看的是历史版本")).toBeVisible();
  await page.getByText("查看依据", { exact: true }).first().click();
  await expect(page.getByText(/已核目录|型号 ID/).first()).toBeVisible();
});

test("M31 无法理解的调整：诚实追问而不是硬猜，保留原方案", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("8000 预算，玩游戏");
  await page.getByRole("button", { name: "生成装机方案" }).click();
  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await expect(page.getByText("方案草稿 · 第 1 版")).toBeVisible();

  await page.getByRole("textbox", { name: "调整方案" }).fill("帮我随便改改");
  await page.getByRole("button", { name: "调整方案" }).click();

  // 追问同时出现在活动时间线与内联反馈（同一事件两处呈现），断言取其一
  await expect(page.getByText(/我没能理解这条调整/).first()).toBeVisible();
  await expect(page.getByText(/本地规则只能处理预算和已有硬件类调整/).first()).toBeVisible();
  await expect(page.getByText("方案草稿 · 第 1 版")).toBeVisible();
});
