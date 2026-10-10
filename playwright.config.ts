import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.RIGMATE_E2E_EXECUTABLE_PATH;

/**
 * E2E 使用独立端口与独立数据库（data/e2e.db），
 * 避免测试项目写进开发库（历史上曾把用户的历史列表灌满测试数据）。
 */
const E2E_PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // dev server 边编译边响应，与请求串行争用；重试一次吸收残余的编译期抖动
  retries: 1,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  expect: {
    // dev 模式路由首次编译可达 2-10s（/design/[id] 实测 >10s），
    // 默认 5s 断言窗口会在冷缓存上间歇性失败；全局放宽到 15s。
    timeout: 15_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    stdout: "pipe",
    command: `npx tsx scripts/reset-e2e-db.ts && npm run dev -- --hostname 127.0.0.1 --port ${E2E_PORT}`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      RIGMATE_DB_PATH: "./data/e2e.db",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], ...(executablePath ? { launchOptions: { executablePath } } : {}) },
  }],
});
