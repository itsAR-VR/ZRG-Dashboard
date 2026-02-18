import { expect, test } from "@playwright/test";

const REQUIRE_AUTH =
  process.env.E2E_REQUIRE_AUTH === "1" ||
  Boolean(process.env.PLAYWRIGHT_STORAGE_STATE || process.env.E2E_AUTH_STORAGE_STATE);

function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? null;
}

test.describe("settings perf canary", () => {
  test("settings initial load stays within budget", async ({ page }) => {
    const runs = Number(process.env.E2E_SETTINGS_PERF_RUNS || "5");
    const p95BudgetMs = Number(process.env.E2E_SETTINGS_P95_BUDGET_MS || "2500");
    const hardMaxMs = Number(process.env.E2E_SETTINGS_HARD_MAX_MS || "10000");
    const samples = [];

    for (let i = 0; i < runs; i += 1) {
      const startedAt = Date.now();
      await page.goto("/?view=settings", { waitUntil: "domcontentloaded" });

      const authRedirected = /\/auth|\/login|sign-in/i.test(page.url());
      test.skip(
        authRedirected && !REQUIRE_AUTH,
        "Authenticated dashboard session is required for settings perf canary."
      );
      expect(
        authRedirected,
        "Authenticated dashboard session is required for settings perf canary. Provide an auth storage state via PLAYWRIGHT_STORAGE_STATE=./playwright/auth/storageState.json (or set E2E_REQUIRE_AUTH=0 to allow skipping)."
      ).toBeFalsy();

      // Wait for the initial settings shell to finish bootstrapping.
      await expect(page.getByRole("tab", { name: /general/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /save settings/i })).toBeVisible();

      const durationMs = Date.now() - startedAt;
      samples.push(durationMs);
      expect(durationMs).toBeLessThanOrEqual(hardMaxMs);

      if (i < runs - 1) {
        await page.reload({ waitUntil: "domcontentloaded" });
      }
    }

    const settingsP95 = p95(samples);
    expect(settingsP95).not.toBeNull();
    expect(settingsP95).toBeLessThanOrEqual(p95BudgetMs);
  });
});

