import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.RIGMATE_E2E_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], ...(executablePath ? { launchOptions: { executablePath } } : {}) },
  }],
});
