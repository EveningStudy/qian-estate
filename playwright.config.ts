import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 测试不启动服务器，也不重置现有演示数据；可单独选择测试文件。
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  outputDir: join(tmpdir(), "qian-estate-playwright", String(process.pid)),
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4311",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
