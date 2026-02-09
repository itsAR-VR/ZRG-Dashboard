import assert from "node:assert/strict";
import test from "node:test";

import { mergeServiceDescriptions } from "../ai-drafts";

test("mergeServiceDescriptions returns null when both inputs are empty", () => {
  assert.equal(mergeServiceDescriptions(null, null), null);
  assert.equal(mergeServiceDescriptions(undefined, undefined), null);
  assert.equal(mergeServiceDescriptions("   ", "\n\t"), null);
});

test("mergeServiceDescriptions returns the non-empty input (trimmed)", () => {
  assert.equal(mergeServiceDescriptions(null, " Pricing details "), "Pricing details");
  assert.equal(mergeServiceDescriptions(" Pricing details ", null), "Pricing details");
});

test("mergeServiceDescriptions de-dupes when one contains the other (case/whitespace-insensitive)", () => {
  const a = "Founders Club membership is $5,000/year.\nWe also offer $500/month.";
  const b = "founders   club membership is $5,000/year.";
  assert.equal(mergeServiceDescriptions(a, b), a);
  assert.equal(mergeServiceDescriptions(b, a), a);
});

test("mergeServiceDescriptions concatenates when both are distinct", () => {
  const a = "Service A: Pricing is $5,000/year.";
  const b = "Service B: Pricing is $10,000/year.";
  assert.equal(mergeServiceDescriptions(a, b), `${a}\n\n${b}`);
});

