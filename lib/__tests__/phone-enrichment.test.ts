import assert from "node:assert/strict";
import test from "node:test";

import { isWithinCallIntentClayDedupeWindow, shouldAttemptClayPhoneEnrichment } from "@/lib/phone-enrichment";

test("isWithinCallIntentClayDedupeWindow returns false when no timestamp exists", () => {
  assert.equal(isWithinCallIntentClayDedupeWindow(null, new Date("2026-02-16T12:00:00.000Z")), false);
});

test("isWithinCallIntentClayDedupeWindow returns true for timestamps inside 24 hours", () => {
  const now = new Date("2026-02-16T12:00:00.000Z");
  const last = new Date("2026-02-15T13:00:00.000Z");
  assert.equal(isWithinCallIntentClayDedupeWindow(last, now), true);
});

test("isWithinCallIntentClayDedupeWindow returns false at or beyond 24 hours", () => {
  const now = new Date("2026-02-16T12:00:00.000Z");
  const exactly24hAgo = new Date("2026-02-15T12:00:00.000Z");
  const beyond24h = new Date("2026-02-15T11:59:59.000Z");
  assert.equal(isWithinCallIntentClayDedupeWindow(exactly24hAgo, now), false);
  assert.equal(isWithinCallIntentClayDedupeWindow(beyond24h, now), false);
});

test("shouldAttemptClayPhoneEnrichment keeps one-time behavior for non-call-intent triggers", () => {
  assert.equal(
    shouldAttemptClayPhoneEnrichment({ triggerReason: "default", inProgress: false, alreadyAttempted: false }),
    true
  );
  assert.equal(
    shouldAttemptClayPhoneEnrichment({ triggerReason: "default", inProgress: false, alreadyAttempted: true }),
    false
  );
});

test("shouldAttemptClayPhoneEnrichment allows call-intent retries when not in progress", () => {
  assert.equal(
    shouldAttemptClayPhoneEnrichment({ triggerReason: "call_intent", inProgress: false, alreadyAttempted: true }),
    true
  );
  assert.equal(
    shouldAttemptClayPhoneEnrichment({ triggerReason: "call_intent", inProgress: true, alreadyAttempted: true }),
    false
  );
});
