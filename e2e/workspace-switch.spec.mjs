import { expect, test } from "@playwright/test";

const CRASH_PATTERN =
  /Minified React error #301|Too many re-renders|\[DashboardShell\] client crash|Application error/i;

function extractWorkspaceId(testId) {
  if (!testId) return null;
  if (!testId.startsWith("workspace-option-")) return null;
  return testId.replace("workspace-option-", "");
}

test.describe("workspace switch regression", () => {
  test("switching workspaces does not crash dashboard or leave inbox error state", async ({ page }) => {
    const crashSignals = [];

    page.on("console", (message) => {
      if (message.type() === "error" && CRASH_PATTERN.test(message.text())) {
        crashSignals.push(message.text());
      }
    });

    page.on("pageerror", (error) => {
      const value = String(error);
      if (CRASH_PATTERN.test(value)) {
        crashSignals.push(value);
      }
    });

    await page.goto("/?view=inbox", { waitUntil: "domcontentloaded" });

    const currentUrl = page.url();
    const authRedirected = /\/auth|\/login|sign-in/i.test(currentUrl);
    test.skip(authRedirected, "Authenticated dashboard session is required for workspace switching.");

    const selectorTrigger = page.getByTestId("workspace-selector-trigger");
    const selectorExists = (await selectorTrigger.count()) > 0;
    test.skip(!selectorExists, "Workspace selector was not found in this environment.");

    await selectorTrigger.click();

    const optionLocator = page.locator('[data-testid^="workspace-option-"]');
    const optionCount = await optionLocator.count();
    test.skip(optionCount < 3, "At least two workspaces are required for the switch regression check.");

    const firstOption = optionLocator.nth(1);
    const secondOption = optionLocator.nth(2);
    const firstWorkspaceId = extractWorkspaceId(await firstOption.getAttribute("data-testid"));
    const secondWorkspaceId = extractWorkspaceId(await secondOption.getAttribute("data-testid"));

    test.skip(!firstWorkspaceId || !secondWorkspaceId, "Workspace IDs were not discoverable.");

    await firstOption.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("clientId")).toBe(firstWorkspaceId);
    await expect(page.getByTestId("dashboard-error-boundary")).toHaveCount(0);
    await expect(page.getByTestId("inbox-error-state")).toHaveCount(0);

    await selectorTrigger.click();
    await secondOption.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("clientId")).toBe(secondWorkspaceId);
    await expect(page.getByTestId("dashboard-error-boundary")).toHaveCount(0);
    await expect(page.getByTestId("inbox-error-state")).toHaveCount(0);
    await expect(page.getByText("Error loading conversations")).toHaveCount(0);

    expect(crashSignals).toEqual([]);
  });
});
