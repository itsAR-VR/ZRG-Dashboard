import test from "node:test";
import assert from "node:assert/strict";
import { buildRevisionHardConstraints, validateRevisionAgainstHardConstraints } from "@/lib/auto-send/revision-constraints";

const offeredSlots = [
  { label: "Fri, Feb 13 at 12:30 PM PST", datetime: "2026-02-13T20:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
  { label: "Fri, Feb 13 at 1:30 PM PST", datetime: "2026-02-13T21:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
];

test("buildRevisionHardConstraints flags one-slot rule for day/window preference", () => {
  const result = buildRevisionHardConstraints({
    inboundBody: "I can chat on Friday between 12PM and 3PM PST",
    offeredSlots,
    bookingLink: "https://cal.example.com/book",
    leadSchedulerLink: null,
  });

  assert.equal(result.preferSingleSlotForWindow, true);
  assert.ok(result.hardRequirements.some((line) => /exactly one/i.test(line)));
});

test("validateRevisionAgainstHardConstraints fails when multiple offered times are proposed for window intent", () => {
  const result = validateRevisionAgainstHardConstraints({
    inboundBody: "Friday between 12 and 3 PST works",
    offeredSlots,
    bookingLink: "https://cal.example.com/book",
    leadSchedulerLink: null,
    draft: "Can we do 12:30 PM PST or 1:30 PM PST on Friday?",
  });

  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("window_over_offer")));
});

test("validateRevisionAgainstHardConstraints fails slot mismatch for unsupported times", () => {
  const result = validateRevisionAgainstHardConstraints({
    inboundBody: "Friday works",
    offeredSlots,
    bookingLink: "https://cal.example.com/book",
    leadSchedulerLink: null,
    draft: "Does 5:00 PM PST on Friday work?",
  });

  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("slot_mismatch")));
});

test("validateRevisionAgainstHardConstraints passes a one-slot confirmation", () => {
  const result = validateRevisionAgainstHardConstraints({
    inboundBody: "Friday between 12 and 3 PST works",
    offeredSlots,
    bookingLink: "https://cal.example.com/book",
    leadSchedulerLink: null,
    draft: "Great, I can lock in Fri, Feb 13 at 1:30 PM PST. Does that work?",
  });

  assert.equal(result.passed, true);
  assert.equal(result.reasons.length, 0);
});
