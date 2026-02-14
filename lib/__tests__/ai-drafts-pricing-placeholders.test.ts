import assert from "node:assert/strict";
import test from "node:test";

import {
  detectPricingHallucinations,
  enforcePricingAmountSafety,
  extractPricingAmounts,
  sanitizeDraftContent,
} from "../ai-drafts";

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

test("extractPricingAmounts extracts grounded prices", () => {
  const result = extractPricingAmounts("Pricing is $791/month or $9,500/year.");
  assert.deepEqual(result.sort((a, b) => a - b), [791, 9500]);
});

test("extractPricingAmounts excludes revenue/threshold amounts", () => {
  const input = "We look for $1M+ in revenue, usually around $50M ARR, and $500k raised.";
  const result = extractPricingAmounts(input);
  assert.deepEqual(result, []);
});

test("extractPricingAmounts excludes qualification thresholds even when 'membership' is mentioned", () => {
  const input = "Our membership requires $1,000,000 ARR (or more) to qualify.";
  const result = extractPricingAmounts(input);
  assert.deepEqual(result, []);
});

test("extractPricingAmounts still extracts pricing even when qualification thresholds appear nearby", () => {
  const input = "We look for $1M ARR founders; membership is $9,500/year.";
  const result = extractPricingAmounts(input);
  assert.deepEqual(result, [9500]);
});

test("extractPricingAmounts still reads regular one-time prices", () => {
  const result = extractPricingAmounts("A one-time onboarding fee is $3,000.");
  assert.deepEqual(result, [3000]);
});

test("detectPricingHallucinations flags unsupported pricing", () => {
  const result = detectPricingHallucinations("Our fee is $3,000", "Pricing: $791 per month", null);
  assert.deepEqual(result.hallucinated, [3000]);
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.cadenceMismatched, []);
});

test("detectPricingHallucinations accepts supported pricing", () => {
  const result = detectPricingHallucinations("It works out to $791/month", "Pricing: $791 per month", null);
  assert.deepEqual(result.hallucinated, []);
  assert.deepEqual(result.valid, [791]);
  assert.deepEqual(result.cadenceMismatched, []);
});

test("detectPricingHallucinations uses knowledgeContext when serviceDescription is silent", () => {
  const result = detectPricingHallucinations("It works out to $791/month", null, "Pricing: $791 per month");
  assert.deepEqual(result.hallucinated, []);
  assert.deepEqual(result.valid, [791]);
  assert.deepEqual(result.cadenceMismatched, []);
});

test("detectPricingHallucinations prefers serviceDescription on conflict", () => {
  const result = detectPricingHallucinations("It is $791/month", "Pricing: $791 per year", "Pricing: $791 per month");
  assert.deepEqual(result.hallucinated, []);
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.cadenceMismatched, [791]);
});

test("detectPricingHallucinations flags cadence mismatch with same amount", () => {
  const result = detectPricingHallucinations("It is $9500/month", "Pricing: $9,500 per year", null);
  assert.deepEqual(result.hallucinated, []);
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.cadenceMismatched, [9500]);
});

test("detectPricingHallucinations does not infer cadence from unknown source cadence", () => {
  const result = detectPricingHallucinations("It is $9,500 per year.", "Membership fee is $9,500.", null);
  assert.deepEqual(result.hallucinated, []);
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.cadenceMismatched, [9500]);
});

test("detectPricingHallucinations keeps cadence scoped to each amount", () => {
  const source = "Membership is $9,500 annually. Flexible options work out to $791 per month.";
  const result = detectPricingHallucinations("Membership is $791 per year.", source, null);
  assert.deepEqual(result.hallucinated, []);
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.cadenceMismatched, [791]);
});

test("detectPricingHallucinations ignores qualification thresholds even when membership is mentioned", () => {
  const draft = "We require $1,000,000 ARR for membership to qualify.";
  const result = detectPricingHallucinations(draft, "Pricing: $791 per month", null);
  assert.deepEqual(result.hallucinated, []);
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.cadenceMismatched, []);
  assert.deepEqual(result.allDraft, []);
});

test("enforcePricingAmountSafety removes unsupported dollar amounts", () => {
  const result = enforcePricingAmountSafety("Our fee is $3,000.", "Pricing: $791 per month");
  assert.equal(result.draft.includes("$3,000"), false);
  assert.deepEqual(result.removedAmounts, [3000]);
  assert.deepEqual(result.removedCadenceAmounts, []);
  assert.equal(result.addedClarifier, false);
});

test("enforcePricingAmountSafety keeps supported dollar amounts", () => {
  const result = enforcePricingAmountSafety("Our fee is $791 per month.", "Pricing: $791 per month");
  assert.equal(result.draft.includes("$791"), true);
  assert.deepEqual(result.removedAmounts, []);
  assert.deepEqual(result.removedCadenceAmounts, []);
  assert.equal(result.addedClarifier, false);
});

test("enforcePricingAmountSafety keeps knowledgeContext pricing when serviceDescription is silent", () => {
  const result = enforcePricingAmountSafety("Our fee is $1,700 per month.", null, "Pricing: $1,700 per month");
  assert.equal(result.draft.includes("$1,700"), true);
  assert.deepEqual(result.removedAmounts, []);
  assert.deepEqual(result.removedCadenceAmounts, []);
  assert.equal(result.addedClarifier, false);
});

test("enforcePricingAmountSafety rewrites cadence-mismatched amount to service-supported cadence", () => {
  const result = enforcePricingAmountSafety("Our fee is $791 per month.", "Pricing: $791 per year", "Pricing: $791 per month");
  assert.equal(result.draft.includes("$791 per year"), true);
  assert.equal(result.draft.includes("per month"), false);
  assert.deepEqual(result.removedAmounts, []);
  assert.deepEqual(result.removedCadenceAmounts, [791]);
  assert.equal(result.addedClarifier, false);
});

test("enforcePricingAmountSafety normalizes monthly plan phrasing under quarterly-only billing", () => {
  const result = enforcePricingAmountSafety(
    "Our monthly payment plan is $1,700.",
    "Pricing: Quarterly only. No monthly payment plan. $1,700 per quarter",
    null
  );
  assert.equal(result.draft.includes("monthly payment plan"), false);
  assert.equal(result.draft.includes("$1,700 per quarter"), true);
  assert.equal(result.addedClarifier, false);
  assert.equal(result.normalizedCadencePhrase, true);
});

test("enforcePricingAmountSafety removes orphan cadence-only pricing lines", () => {
  const result = enforcePricingAmountSafety(
    "The membership fee is $791 per year.\n\nMembership is /year.\n\nBest,\nChris",
    "Pricing: $9,500 per year. Flexible options: $791 per month",
    null,
    { requirePricingAnswer: true }
  );
  assert.equal(result.draft.includes("Membership is /year"), false);
  assert.equal(result.draft.includes("$791"), true);
});

test("enforcePricingAmountSafety adds cadence-safe clarifier when no source pricing exists", () => {
  const result = enforcePricingAmountSafety("Our fee is $3,000.", null);
  assert.equal(result.draft.includes("$3,000"), false);
  assert.equal(result.draft.includes("which pricing details you want"), true);
  assert.deepEqual(result.removedAmounts, [3000]);
  assert.deepEqual(result.removedCadenceAmounts, []);
  assert.equal(result.addedClarifier, true);
});

test("enforcePricingAmountSafety does not strip revenue-threshold amounts", () => {
  const result = enforcePricingAmountSafety("We typically work with $1M+ revenue founders.", null);
  assert.equal(result.draft.includes("$1M+"), true);
  assert.deepEqual(result.removedAmounts, []);
  assert.deepEqual(result.removedCadenceAmounts, []);
  assert.equal(result.addedClarifier, false);
});

test("enforcePricingAmountSafety does not strip revenue-threshold amounts when membership language is present", () => {
  const result = enforcePricingAmountSafety("To qualify for membership, you need $1,000,000+ ARR.", null);
  assert.equal(result.draft.includes("$1,000,000+"), true);
  assert.deepEqual(result.removedAmounts, []);
  assert.deepEqual(result.removedCadenceAmounts, []);
  assert.equal(result.addedClarifier, false);
});
