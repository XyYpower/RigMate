import { test, expect } from "@playwright/test";

/**
 * Task 7（2026-09-28 基线）：响应式收口。
 * DESIGN.md §4 硬约束：全站禁止横向滚动——桌面与窄屏断言 scrollWidth 不超过视口。
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
