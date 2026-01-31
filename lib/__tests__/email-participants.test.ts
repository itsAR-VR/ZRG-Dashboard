import assert from "node:assert/strict";
import test from "node:test";

import {
  addToAlternateEmails,
  applyOutboundToOverride,
  computeLeadCurrentReplierUpdate,
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

test("applyOutboundToOverride ensures primary is CC'd when To differs", () => {
  const result = applyOutboundToOverride({
    primaryEmail: "lead@example.com",
    baseToEmail: "cc@example.com",
    baseToName: null,
    baseCc: [],
    overrideToEmail: "cc@example.com",
    overrideToName: "Teddy",
  });

  assert.equal(result.overrideApplied, true);
  assert.equal(result.toEmail, "cc@example.com");
  assert.deepEqual(result.cc, ["lead@example.com"]);
});

test("applyOutboundToOverride removes To from CC and removes primary when primary is the To", () => {
  const result = applyOutboundToOverride({
    primaryEmail: "lead@example.com",
    baseToEmail: "cc@example.com",
    baseToName: null,
    baseCc: ["lead@example.com", "cc@example.com", "other@example.com"],
    overrideToEmail: "lead@example.com",
    overrideToName: "Lead",
  });

  assert.equal(result.overrideApplied, true);
  assert.equal(result.toEmail, "lead@example.com");
  assert.deepEqual(result.cc, ["cc@example.com", "other@example.com"]);
});

test("computeLeadCurrentReplierUpdate sets current replier only when To differs from primary", () => {
  const now = new Date("2026-01-31T00:00:00.000Z");
  const result = computeLeadCurrentReplierUpdate({
    primaryEmail: "lead@example.com",
    selectedToEmail: "cc@example.com",
    selectedToName: "Teddy",
    existingAlternateEmails: [],
    existingCurrentReplierEmail: null,
    existingCurrentReplierName: null,
    existingCurrentReplierSince: null,
    now,
  });

  assert.equal(result.changed, true);
  assert.equal(result.currentReplierEmail, "cc@example.com");
  assert.equal(result.currentReplierName, "Teddy");
  assert.equal(result.currentReplierSince?.toISOString(), now.toISOString());
  assert.deepEqual(result.alternateEmails, ["cc@example.com"]);
});

test("computeLeadCurrentReplierUpdate clears current replier when selecting primary", () => {
  const now = new Date("2026-01-31T00:00:00.000Z");
  const result = computeLeadCurrentReplierUpdate({
    primaryEmail: "lead@example.com",
    selectedToEmail: "lead@example.com",
    selectedToName: "Lead",
    existingAlternateEmails: ["lead@example.com", "cc@example.com"],
    existingCurrentReplierEmail: "cc@example.com",
    existingCurrentReplierName: "Teddy",
    existingCurrentReplierSince: new Date("2026-01-01T00:00:00.000Z"),
    now,
  });

  assert.equal(result.currentReplierEmail, null);
  assert.equal(result.currentReplierName, null);
  assert.equal(result.currentReplierSince, null);
  assert.deepEqual(result.alternateEmails, ["cc@example.com"]);
});

test("computeLeadCurrentReplierUpdate preserves currentReplierSince when email is unchanged", () => {
  const existingSince = new Date("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-01-31T00:00:00.000Z");
  const result = computeLeadCurrentReplierUpdate({
    primaryEmail: "lead@example.com",
    selectedToEmail: "cc@example.com",
    selectedToName: "Teddy",
    existingAlternateEmails: ["cc@example.com"],
    existingCurrentReplierEmail: "cc@example.com",
    existingCurrentReplierName: "Teddy",
    existingCurrentReplierSince: existingSince,
    now,
  });

  assert.equal(result.changed, false);
  assert.equal(result.currentReplierSince?.toISOString(), existingSince.toISOString());
});
