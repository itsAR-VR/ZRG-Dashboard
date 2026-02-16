import { expect, test } from "@playwright/test";

const REQUIRE_AUTH =
  process.env.E2E_REQUIRE_AUTH === "1" ||
  Boolean(process.env.PLAYWRIGHT_STORAGE_STATE || process.env.E2E_AUTH_STORAGE_STATE);

function parseHeaderNumber(value) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? null;
}

async function probeInboxViaFetch(page, { search } = {}) {
  const result = await page.evaluate(async ({ search }) => {
    const clientId = new URL(location.href).searchParams.get("clientId");
    const paramsBase = new URLSearchParams();
    if (clientId) paramsBase.set("clientId", clientId);

    const probe = async (pathname, extra) => {
      const params = new URLSearchParams(paramsBase);
      for (const [key, value] of Object.entries(extra || {})) {
        if (value === undefined || value === null) continue;
        params.set(key, String(value));
      }

      const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      const json = await res.json().catch(() => null);
      return {
        status: res.status,
        durationMs: Number(res.headers.get("x-zrg-duration-ms") || NaN),
        requestId: res.headers.get("x-request-id"),
        json,
      };
    };

    return {
      counts: await probe("/api/inbox/counts", {}),
      conversations: await probe("/api/inbox/conversations", {
        limit: 50,
        ...(search ? { search } : {}),
      }),
    };
  }, { search: search || "" });

  return {
    counts: {
      status: result.counts.status,
      durationMs: Number.isFinite(result.counts.durationMs) ? result.counts.durationMs : null,
      requestId: result.counts.requestId ?? null,
      json: result.counts.json,
    },
    conversations: {
      status: result.conversations.status,
      durationMs: Number.isFinite(result.conversations.durationMs) ? result.conversations.durationMs : null,
      requestId: result.conversations.requestId ?? null,
      json: result.conversations.json,
    },
  };
}

test.describe("inbox perf canary", () => {
  test("master inbox load stays within server timing budget", async ({ page }) => {
    const runs = Number(process.env.E2E_INBOX_PERF_RUNS || "5");
    const countsBudgetMs = Number(process.env.E2E_INBOX_COUNTS_BUDGET_MS || "2000");
    const conversationsBudgetMs = Number(process.env.E2E_INBOX_CONVERSATIONS_BUDGET_MS || "3000");
    const hardMaxMs = Number(process.env.E2E_INBOX_HARD_MAX_MS || "8000");

    const countsSamples = [];
    const conversationsSamples = [];

    await page.goto("/?view=inbox", { waitUntil: "domcontentloaded" });
    const authRedirected = /\/auth|\/login|sign-in/i.test(page.url());
    test.skip(authRedirected && !REQUIRE_AUTH, "Authenticated dashboard session is required for perf canary.");
    expect(
      authRedirected,
      "Authenticated dashboard session is required for perf canary. Provide an auth storage state via PLAYWRIGHT_STORAGE_STATE=./playwright/auth/storageState.json (or set E2E_REQUIRE_AUTH=0 to allow skipping)."
    ).toBeFalsy();

    for (let i = 0; i < runs; i += 1) {
      if (i > 0) {
        await page.reload({ waitUntil: "domcontentloaded" });
      }

      const sample = await probeInboxViaFetch(page);
      expect(sample.counts.status).toBe(200);
      expect(sample.conversations.status).toBe(200);

      expect(sample.counts.durationMs).not.toBeNull();
      expect(sample.conversations.durationMs).not.toBeNull();

      countsSamples.push(sample.counts.durationMs);
      conversationsSamples.push(sample.conversations.durationMs);

      expect(sample.counts.durationMs).toBeLessThanOrEqual(hardMaxMs);
      expect(sample.conversations.durationMs).toBeLessThanOrEqual(hardMaxMs);
    }

    const countsP95 = p95(countsSamples);
    const conversationsP95 = p95(conversationsSamples);

    // Budget checks use server-reported timings to avoid network variance.
    expect(countsP95).not.toBeNull();
    expect(conversationsP95).not.toBeNull();
    expect(countsP95).toBeLessThanOrEqual(countsBudgetMs);
    expect(conversationsP95).toBeLessThanOrEqual(conversationsBudgetMs);
  });

  test("email search does not trigger slow inbox scans", async ({ page }) => {
    const searchBudgetMs = Number(process.env.E2E_INBOX_EMAIL_SEARCH_BUDGET_MS || "2000");
    const hardMaxMs = Number(process.env.E2E_INBOX_HARD_MAX_MS || "8000");

    await page.goto("/?view=inbox", { waitUntil: "domcontentloaded" });
    const authRedirected = /\/auth|\/login|sign-in/i.test(page.url());
    test.skip(authRedirected && !REQUIRE_AUTH, "Authenticated dashboard session is required for inbox search canary.");
    expect(
      authRedirected,
      "Authenticated dashboard session is required for inbox search canary. Provide an auth storage state via PLAYWRIGHT_STORAGE_STATE=./playwright/auth/storageState.json (or set E2E_REQUIRE_AUTH=0 to allow skipping)."
    ).toBeFalsy();

    const initial = await probeInboxViaFetch(page);

    const conversations = initial.conversations?.json?.conversations || [];
    const email =
      conversations.find((c) => typeof c?.lead?.email === "string" && c.lead.email.includes("@"))?.lead?.email ?? null;

    test.skip(!email, "No lead email was available in the inbox list response.");

    await page.getByTestId("inbox-search-input").fill(email);
    // Allow debounce to kick in before probing.
    await page.waitForTimeout(400);

    const searched = await probeInboxViaFetch(page, { search: email });
    expect(searched.conversations.status).toBe(200);
    expect(searched.conversations.durationMs).not.toBeNull();
    expect(searched.conversations.durationMs).toBeLessThanOrEqual(hardMaxMs);
    expect(searched.conversations.durationMs).toBeLessThanOrEqual(searchBudgetMs);
  });
});
