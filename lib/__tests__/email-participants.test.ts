import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeCcList } from "../email-participants";

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

