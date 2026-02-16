import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.E2E_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://127.0.0.1:3000";

const storageStatePath =
  process.env.PLAYWRIGHT_STORAGE_STATE || process.env.E2E_AUTH_STORAGE_STATE;

const useWebServer = process.env.E2E_USE_WEBSERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    storageState: storageStatePath || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useWebServer
    ? {
        // Next can leave a stale `.next/lock` behind after interrupted builds; clear it for reliable E2E runs.
        command:
          "node -e \"require('fs').rmSync('.next/lock', { force: true })\" && npm run build && npm run start",
        url: baseURL,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
});
