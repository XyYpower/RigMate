import { test, expect } from "@playwright/test";

test("M27 目标驱动主链路：自然语言生成方案、自动校验并接受进入 DIY", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏");
  await page.getByRole("button", { name: "开始搭配" }).click();

  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  // 参考图形态：预算标尺 + 摘要卡 + 配置清单 + 核验台 + 状态徽章
  await expect(page.getByRole("heading", { name: "核验台" })).toBeVisible();
  const ruler = page.locator(".budget-ruler");
  await expect(ruler).toBeVisible();
  await expect(ruler).toContainText("预算 ¥20,000");
  await expect(page.locator(".build-summary")).toBeVisible();
  await expect(page.getByRole("heading", { name: "配置清单" })).toBeVisible();
  await expect(page.locator(".wb-status-badge")).toBeVisible();
  await expect(page.getByText("价格来自已审核证据，非实时成交价").first()).toBeVisible();

  // 配置清单核验状态：逐行真实来源，白色外观待确认可读
  await expect(page.locator(".build-parts-verify").first()).toBeVisible();
  await expect(page.locator(".build-parts").getByText("待确认").first()).toBeVisible();

  // 真实事件保留在折叠的处理记录里（核验台 ≥1200 在右栏、<1200 内联主区，只取可见的一份）
  const visibleDesk = page.locator(".verification-desk").filter({ visible: true });
  await visibleDesk.locator(".verification-log summary").click();
  await expect(visibleDesk.getByText("正在检索目录和已核验规格。")).toBeVisible();

  const accept = page.getByRole("button", { name: "接受这一版" });
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page).toHaveURL(/\/diy\?project=[0-9a-f-]+/);
  await expect(page.getByRole("heading", { name: /视频剪辑 \+ 游戏/ })).toBeVisible();
  await expect(page.getByText(/已从方案库打开|已恢复最近的项目/)).toBeVisible();
});

test("M27 目标信息不足：不硬凑方案而是提出最小追问", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("帮我配一台电脑");
  await page.getByRole("button", { name: "开始搭配" }).click();

  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await expect(page.getByRole("heading", { name: "还差一点信息" })).toBeVisible();
  await expect(page.getByText(/缺少预算或用途/)).toBeVisible();
});

test("M31 自然语言修订：顶栏输入，预算跨档位生成第 2 版并显示差异", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("2 万预算，白色海景房，剪辑和游戏");
  await page.getByRole("button", { name: "开始搭配" }).click();
  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await expect(page.locator(".build-summary h2")).toContainText("白色");

  // 参考图：修订输入在顶栏
  const headerEditor = page.getByRole("textbox", { name: "继续调整这套方案" });
  await expect(headerEditor).toBeVisible();
  await headerEditor.fill("预算压到 4000");
  await page.getByRole("button", { name: "提交修改" }).click();

  // 处理记录（折叠）承载真实事件；展开后可读
  const visibleDesk = page.locator(".verification-desk").filter({ visible: true });
  await visibleDesk.locator(".verification-log summary").click();
  await expect(visibleDesk.getByText(/已理解调整：预算调整为 4,000 元/)).toBeVisible();
  await expect(page.locator(".header-title-version")).toContainText("方案 v2");
  // 版本差异区：预算跌破档位线，CPU/显卡/电源应出现 旧件→新件 的变化
  const diff = page.locator(".proposal-diff");
  await expect(diff.getByRole("heading", { name: "相对第 1 版的变化" })).toBeVisible();
  await expect(diff).toContainText("4070 SUPER");
  await expect(diff).toContainText("RTX 4060");
});

test("M35 可以切换查看历史方案并展开单件依据", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("2 万预算，剪辑和游戏");
  await page.getByRole("button", { name: "开始搭配" }).click();
  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await page.getByRole("textbox", { name: "继续调整这套方案" }).fill("预算压到 4000");
  await page.getByRole("button", { name: "提交修改" }).click();
  await expect(page.locator(".header-title-version")).toContainText("方案 v2");

  const versionPicker = page.getByRole("combobox", { name: "方案版本" });
  await expect(versionPicker).toBeVisible();
  await versionPicker.selectOption("1");
  await expect(page.locator(".header-title-version")).toContainText("历史版本");
  // 历史版本：顶栏修订输入被替换为提示；展开单件依据仍可见
  await expect(page.getByText(/正在查看历史版本/)).toBeVisible();
  await page.locator(".build-parts-row summary").first().click();
  await expect(page.locator(".build-parts-detail").first()).toContainText(/已核目录型号|型号 ID/);
});

test("M31 无法理解的调整：诚实追问而不是硬猜，保留原方案", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).fill("8000 预算，玩游戏");
  await page.getByRole("button", { name: "开始搭配" }).click();
  await expect(page).toHaveURL(/\/design\/[0-9a-f-]+/);
  await expect(page.locator(".header-title-version")).toContainText("方案 v1");

  await page.getByRole("textbox", { name: "继续调整这套方案" }).fill("帮我随便改改");
  await page.getByRole("button", { name: "提交修改" }).click();

  // 追问出现在内联反馈与处理记录时间线（同一事件两处呈现）；内联反馈直接断言
  await expect(page.locator(".revision-feedback")).toContainText(/我没能理解这条调整/);
  await expect(page.locator(".revision-feedback")).toContainText(/本地规则只能处理预算和已有硬件类调整/);
  await expect(page.locator(".header-title-version")).toContainText("方案 v1");
});
