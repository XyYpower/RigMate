import { test, expect } from "@playwright/test";

/**
 * Task 7（2026-09-28 基线）：响应式收口。
 * DESIGN.md §4 硬约束：全站禁止横向滚动——桌面与窄屏断言 scrollWidth 不超过视口。
 * 2026-10-08 决策台重置：新增三档布局（1440/1024/390）下装配轨道、预算标尺、
 * 核验台可见性 + 主按钮可聚焦 + 键盘可达 + reduced-motion 可读。
 */

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

const PAGES = ["/", "/projects", "/hardware", "/diy"];

for (const viewport of VIEWPORTS) {
  for (const path of PAGES) {
    test(`无横向滚动：${path} @ ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(path);
      // 等待客户端渲染与字体稳定
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(400);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
    });
  }
}

/** 决策台三件套（AssemblyRail / BudgetRuler / VerificationDesk）的三档布局验收 */
const BENCH_VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 1000 },
  { width: 390, height: 844 },
];

async function createDesignViaApi(page: import("@playwright/test").Page): Promise<string> {
  const response = await page.request.post("/api/design", {
    data: { rawInput: "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏" },
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.result.request.id as string;
}

for (const viewport of BENCH_VIEWPORTS) {
  test(`决策台三件套可见：首页 @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("region", { name: "整机装配轨道" })).toBeVisible();
    await expect(page.locator(".budget-ruler")).toBeVisible();
    await expect(page.locator(".home-caps")).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 1);

    const submit = page.getByRole("button", { name: /开始搭配/ });
    await expect(submit).toBeVisible();
    await submit.focus();
    await expect(submit).toBeFocused();
  });

  test(`决策台三件套可见：方案页 @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const designId = await createDesignViaApi(page);
    await page.goto(`/design/${designId}`);
    await page.waitForLoadState("domcontentloaded");

    // 方案页：右栏装配轨道 + 预算标尺 + 核验台
    await expect(page.getByRole("region", { name: "本方案装配轨道" })).toBeVisible();
    const ruler = page.locator(".budget-ruler");
    await expect(ruler).toBeVisible();
    await expect(page.getByRole("heading", { name: "核验台" })).toBeVisible();

    // 页面不横向滚动；装配轨道自身的横滚只发生在组件内部
    const scroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(scroll.doc).toBeLessThanOrEqual(scroll.win + 1);

    // 主按钮可聚焦
    const accept = page.getByRole("button", { name: /接受这一版|保留当前配置并接受/ }).first();
    await expect(accept).toBeVisible();
    await accept.focus();
    await expect(accept).toBeFocused();
  });
}

test("键盘：目标输入 → 预算 → 主按钮一路 Tab 可达", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "描述你的装机目标" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "预算（元，可选）" })).toBeFocused();

  // 预算快捷档 4 个 + 主按钮：连续 Tab 后主按钮应获得焦点
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    if (await page.getByRole("button", { name: /开始搭配/ }).evaluate((el) => el === document.activeElement)) {
      break;
    }
  }
  await expect(page.getByRole("button", { name: /开始搭配/ })).toBeFocused();
});

test("键盘：方案页核验台证据动作 Tab 可达", async ({ page }) => {
  const designId = await createDesignViaApi(page);
  await page.goto(`/design/${designId}`);
  const desk = page.locator(".verification-desk");
  await expect(desk).toBeVisible();

  const evidenceButton = desk.getByRole("button", { name: "看选择理由" }).first();
  await expect(evidenceButton).toBeAttached();
  await evidenceButton.focus();
  await expect(evidenceButton).toBeFocused();

  // 触发证据动作：配置清单中对应类别行展开
  await evidenceButton.click();
  await expect(page.locator(".build-parts-row[open]").first()).toBeVisible();
});

test("reduced-motion：动画关闭时首页与方案页内容直接可读", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "整机装配轨道" })).toBeVisible();
  await expect(page.locator(".budget-ruler")).toContainText("未设置预算");

  const designId = await createDesignViaApi(page);
  await page.goto(`/design/${designId}`);
  await expect(page.locator(".build-summary")).toBeVisible();
  await expect(page.getByRole("heading", { name: "核验台" })).toBeVisible();
});
