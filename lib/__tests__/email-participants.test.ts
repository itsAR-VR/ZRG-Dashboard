import assert from "node:assert/strict";
import test from "node:test";

import {
  addToAlternateEmails,
  detectCcReplier,
  emailsMatch,
  normalizeOptionalEmail,
  sanitizeCcList,
} from "../email-participants";

test("sanitizeCcList normalizes, dedupes, and filters invalid emails", () => {
  const result = sanitizeCcList([" TEST@Example.com ", "test@example.com", "not-an-email"]);
  assert.deepEqual(result.valid, ["test@example.com"]);
  assert.deepEqual(result.invalid, ["not-an-email"]);
});

test("sanitizeCcList enforces maxCc limit", () => {
  const emails = Array.from({ length: 50 }, (_, i) => `user${i}@example.com`);
  const result = sanitizeCcList(emails, 20);
  assert.equal(result.valid.length, 20);
  assert.equal(result.invalid.length, 0);
});

test("normalizeOptionalEmail handles null/empty and normalizes", () => {
  assert.equal(normalizeOptionalEmail(null), null);
  assert.equal(normalizeOptionalEmail(undefined), null);
  assert.equal(normalizeOptionalEmail("   "), null);
  assert.equal(normalizeOptionalEmail(" TEST@Example.com "), "test@example.com");
});

test("emailsMatch is case-insensitive and null-safe", () => {
  assert.equal(emailsMatch("TEST@Example.com", "test@example.com"), true);
  assert.equal(emailsMatch("a@example.com", "b@example.com"), false);
  assert.equal(emailsMatch(null, "b@example.com"), false);
});

test("detectCcReplier returns true only when emails differ", () => {
  assert.equal(
    detectCcReplier({ leadEmail: "max@example.com", inboundFromEmail: "teddy@example.com" }).isCcReplier,
    true
  );
  assert.equal(
    detectCcReplier({ leadEmail: "max@example.com", inboundFromEmail: "MAX@example.com" }).isCcReplier,
    false
  );
  assert.equal(detectCcReplier({ leadEmail: null, inboundFromEmail: "teddy@example.com" }).isCcReplier, false);
});

test("addToAlternateEmails normalizes, dedupes, and excludes primary", () => {
  const result = addToAlternateEmails(["MAX@Example.com", "other@example.com"], "TEDDY@example.com", "max@example.com");
  assert.deepEqual(result, ["other@example.com", "teddy@example.com"]);
});
