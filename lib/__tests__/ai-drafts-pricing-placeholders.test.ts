import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeDraftContent } from "../ai-drafts";

function withMutedWarn<T>(fn: () => T): T {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    return fn();
  } finally {
    console.warn = originalWarn;
  }
}

test("sanitizeDraftContent strips ${PRICE}-style placeholders", () => {
  const input = "Hi,\n\nMembership is ${PRICE} per [month/year].\n\nBest,\nChris";
  const output = withMutedWarn(() => sanitizeDraftContent(input, "lead-1", "email"));
  assert.equal(output.includes("${PRICE}"), false);
  assert.equal(output.includes("Membership is per"), true);
});

test("sanitizeDraftContent strips $X/$Y/$A placeholders without stripping real dollar amounts", () => {
  const input =
    "Hi,\n\nIt depends on the tier, but pricing typically ranges from $X to $Y per month (or $A per year).\n\nBest,\nChris";
  const output = withMutedWarn(() => sanitizeDraftContent(input, "lead-1", "email"));
  assert.equal(output.includes("$X"), false);
  assert.equal(output.includes("$Y"), false);
  assert.equal(output.includes("$A"), false);
  assert.equal(output.includes("per month"), true);
  assert.equal(output.includes("per year"), true);
});

test("sanitizeDraftContent strips $X-$Y ranges", () => {
  const input = "Pricing ranges from $X-$Y depending on tier.";
  const output = withMutedWarn(() => sanitizeDraftContent(input, "lead-1", "email"));
  assert.equal(output.includes("$X"), false);
  assert.equal(output.includes("$Y"), false);
  assert.equal(output.includes("-"), false);
});

test("sanitizeDraftContent does not strip real prices like $5,000/year, $500/month, or $0", () => {
  const input = "Annual membership is $5,000/year (we also offer $500/month). $0 due today.";
  const output = withMutedWarn(() => sanitizeDraftContent(input, "lead-1", "email"));
  assert.equal(output.includes("$5,000"), true);
  assert.equal(output.includes("$500"), true);
  assert.equal(output.includes("$0"), true);
});

