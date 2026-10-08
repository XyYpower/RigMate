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
    // 首页横向轨道必须带清晰的滚动提示
    await expect(page.locator(".home-rail-hint")).toBeVisible();
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

    // 方案页：主区装配轨道 + 预算标尺 + 核验台
    const rail = page.getByRole("region", { name: "本方案装配轨道" });
    await expect(rail).toBeVisible();
    const ruler = page.locator(".budget-ruler");
    await expect(ruler).toBeVisible();
    await expect(page.getByRole("heading", { name: "核验台" })).toBeVisible();

    // 页面不横向滚动
    const scroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(scroll.doc).toBeLessThanOrEqual(scroll.win + 1);

    // 1440/1024/390 三档下主区装配轨道的八类槽位必须全部同屏可见（网格平铺，不被右栏截断）
    const slotMetrics = await rail.locator(".assembly-slot").evaluateAll((slots) =>
      slots.map((slot) => {
        const rect = slot.getBoundingClientRect();
        return { left: rect.left, right: rect.right, visible: rect.width > 0 && rect.height > 0 };
      }),
    );
    expect(slotMetrics).toHaveLength(8);
    for (const metric of slotMetrics) {
      expect(metric.visible, "槽位应渲染出尺寸").toBe(true);
      expect(metric.left, "槽位左缘不得越出视口").toBeGreaterThanOrEqual(-1);
      expect(metric.right, `槽位右缘不得越出视口 ${viewport.width}px`).toBeLessThanOrEqual(viewport.width + 1);
    }

    // 主按钮可聚焦
    const accept = page.getByRole("button", { name: /接受这一版|保留当前配置并接受/ }).first();
    await expect(accept).toBeVisible();
    await accept.focus();
    await expect(accept).toBeFocused();
  });
}

test("1024px 方案页：核验台摘要在配置清单之后、决策动作之前", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  const designId = await createDesignViaApi(page);
  await page.goto(`/design/${designId}`);
  await page.locator(".build-summary").waitFor({ timeout: 60000 });

  // 内联核验台可见；右栏挂载点隐藏
  const inlineDesk = page.locator(".design-desk-inline .verification-desk");
  await expect(inlineDesk).toBeVisible();
  await expect(page.locator(".design-desk-inline")).toBeVisible();
  await expect(page.locator(".design-desk-aside")).toBeHidden();
  await expect(inlineDesk.getByRole("heading", { name: "核验台" })).toBeVisible();

  // DOM 顺序：配置清单 → 内联核验台 → 决策条/主动作（几何位置验证，不只查源码顺序）
  const order = await page.evaluate(() => {
    const yOf = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
    };
    return {
      parts: yOf(".build-parts-section"),
      desk: yOf(".design-desk-inline"),
      actions: yOf(".proposal-actions"),
      banner: yOf(".decision-banner"),
    };
  });
  expect(order.parts).toBeTruthy();
  expect(order.desk).toBeTruthy();
  expect(order.actions ?? order.banner).toBeTruthy();
  expect(order.desk!.top, "核验台应在配置清单之后").toBeGreaterThanOrEqual(order.parts!.top);
  expect(order.desk!.bottom, "核验台应在主动作之前").toBeLessThanOrEqual((order.actions ?? order.banner)!.bottom + 1);

  // 页面仍无横向滚动
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(1024 + 1);
});

test("决策台品牌一致：/projects 与报告页的导航、标题、状态文案可访问", async ({ page }) => {
  // /projects：三主入口导航 + 页头标题 + 生命周期状态徽章
  await page.goto("/projects");
  const nav = page.getByRole("navigation", { name: "主导航" });
  await expect(nav.getByRole("link", { name: "我的方案" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "开始配置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "方案库" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "整机复核" })).toBeVisible();

  // 经真实 API 建一个正式方案 + 报告
  const design = await page.request.post("/api/design", {
    data: { rawInput: "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏" },
  });
  expect(design.ok()).toBeTruthy();
  const designData = await design.json();
  const accepted = await page.request.post(`/api/design/${designData.result.proposal.id}/accept`, { data: {} });
  expect(accepted.ok()).toBeTruthy();
  const { buildId } = await accepted.json();

  await page.goto(`/builds/${buildId}/report`);
  // 报告页保持同一品牌壳：导航 + 页头标题 + 状态徽章 + 主动作
  await expect(nav.getByRole("link", { name: "我的方案" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "检查报告" })).toBeVisible();
  await expect(page.locator(".report-page .wb-status-badge")).toBeVisible();
  await expect(page.getByRole("button", { name: /打印 \/ 导出 PDF/ })).toBeVisible();

  // /projects 复核主流程：解析后主按钮出现且可聚焦
  await page.goto("/projects");
  await page.getByRole("textbox", { name: "复核配置单" }).fill("CPU：AMD 锐龙7 9800X3D 8核16线程 散片");
  await page.getByRole("button", { name: "解析配置单" }).click();
  const createButton = page.getByRole("button", { name: /创建项目并运行检查/ });
  await expect(createButton).toBeVisible();
  await createButton.focus();
  await expect(createButton).toBeFocused();
});

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
  // 核验台在 ≥1200 挂右栏、<1200 内联主区——只取可见的那一份
  const desk = page.locator(".verification-desk").filter({ visible: true });
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
