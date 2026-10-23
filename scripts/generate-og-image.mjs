// 品牌资产生成：OG/Twitter 分享卡（1200×630 PNG，写入 src/app 文件约定位）。
// 视觉与 icon.svg / DESIGN.md v2 同源：浅灰白画布 + 仪器橙 R + 蓝灰墨。
// 品牌换标后重跑：node scripts/generate-og-image.mjs
import { chromium } from "@playwright/test";
import { copyFileSync } from "node:fs";

const HTML = `
<body style="margin:0;width:1200px;height:630px;background:#f4f5f6;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI','Microsoft YaHei',system-ui,sans-serif;">
  <div style="display:flex;flex-direction:column;align-items:center;gap:26px;">
    <div style="display:grid;place-items:center;width:128px;height:128px;border-radius:28px;background:#f4581c;color:#fff;font-size:72px;font-weight:800;box-shadow:0 12px 32px rgba(244,88,28,0.28);">R</div>
    <div style="font-size:76px;font-weight:800;color:#111827;letter-spacing:-2px;">RigMate</div>
    <div style="font-size:34px;font-weight:600;color:#6b7280;">PC 装机决策工作台</div>
    <div style="font-size:24px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:22px;">先确认能装，再决定买什么</div>
  </div>
</body>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(HTML);
await page.waitForTimeout(300);
await page.screenshot({ path: "src/app/opengraph-image.png" });
await browser.close();
copyFileSync("src/app/opengraph-image.png", "src/app/twitter-image.png");
console.log("已生成 src/app/opengraph-image.png + twitter-image.png（1200×630）");
