import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.RIGMATE_E2E_EXECUTABLE_PATH;

/**
 * E2E 使用独立端口与独立数据库（data/e2e.db），
 * 避免测试项目写进开发库（历史上曾把用户的历史列表灌满测试数据）。
 */
const E2E_PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `node scripts/reset-e2e-db.mjs && npm run dev -- --hostname 127.0.0.1 --port ${E2E_PORT}`,
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
