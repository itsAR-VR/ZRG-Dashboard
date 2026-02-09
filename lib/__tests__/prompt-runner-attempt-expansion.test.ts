import assert from "node:assert/strict";
import test from "node:test";

import { expandOutputTokenAttempts } from "../ai/prompt-runner/attempts";

test("expandOutputTokenAttempts expands attempts by multiplier when retryExtraTokens is unset", () => {
  const out = expandOutputTokenAttempts({ attempts: [1000], maxAttempts: 3, multiplier: 1.2, cap: 10_000 });
  assert.deepEqual(out, [1000, 1200, 1440]);
});

test("expandOutputTokenAttempts prefers additive retryExtraTokens when it exceeds multiplier growth", () => {
  const out = expandOutputTokenAttempts({
    attempts: [3200],
    maxAttempts: 3,
    multiplier: 1.2,
    cap: 6400,
    retryExtraTokens: 1600,
  });
  assert.deepEqual(out, [3200, 4800, 6400]);
});

test("expandOutputTokenAttempts respects cap and stops expanding when capped", () => {
  const out = expandOutputTokenAttempts({ attempts: [1000], maxAttempts: 10, multiplier: 2, cap: 2500 });
  assert.deepEqual(out, [1000, 2000, 2500]);
});

test("expandOutputTokenAttempts ignores non-positive retryExtraTokens", () => {
  const out = expandOutputTokenAttempts({
    attempts: [1000],
    maxAttempts: 3,
    multiplier: 1.2,
    cap: 5000,
    retryExtraTokens: 0,
  });
  assert.deepEqual(out, [1000, 1200, 1440]);
});

