// 品牌资产生成：把 src/app/icon.svg 渲染成多尺寸 favicon.ico（PNG 内嵌格式）。
// 依赖 @playwright/test 自带的 chromium；品牌换标后重跑：node scripts/generate-favicon.mjs
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const SIZES = [16, 32, 48];
const svg = readFileSync(new URL("../src/app/icon.svg", import.meta.url), "utf8");
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const pngs = [];
for (const size of SIZES) {
  await page.setContent(
    `<body style="margin:0"><img id="mark" src="${dataUrl}" width="${size}" height="${size}"></body>`,
  );
  await page.locator("#mark").waitFor();
  const shot = await page.locator("#mark").screenshot();
  // Next 构建要求 ICO 内嵌 PNG 为 RGBA：经 OffscreenCanvas 重编码补 alpha 通道
  pngs.push(Buffer.from(await page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const out = await canvas.convertToBlob({ type: "image/png" });
    return Array.from(new Uint8Array(await out.arrayBuffer()));
  }, shot.toString("base64"))));
}
await browser.close();

// ICO 容器：ICONDIR + ICONDIRENTRY×N + PNG 数据
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(SIZES.length, 4);
let offset = 6 + 16 * SIZES.length;
const entries = [];
const pngBuffers = [];
for (let index = 0; index < SIZES.length; index += 1) {
  const size = SIZES[index];
  const png = pngs[index];
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  entries.push(entry);
  pngBuffers.push(png);
}
writeFileSync(new URL("../src/app/favicon.ico", import.meta.url), Buffer.concat([header, ...entries, ...pngBuffers]));
console.log(`favicon.ico 已生成：${SIZES.join("/")}px`);
