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

test("buildRevisionHardConstraints requires link fallback when no offered slot matches requested window", () => {
  const result = buildRevisionHardConstraints({
    inboundBody: "Monday morning works for me",
    offeredSlots: [
      { label: "Mon, Feb 16 at 6:30 PM PST", datetime: "2026-02-17T02:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: "https://cal.example.com/book",
    leadSchedulerLink: null,
  });

  assert.ok(result.hardRequirements.some((line) => /no offered slot matches the requested window/i.test(line)));
});

test("validateRevisionAgainstHardConstraints fails when no window-matching slot exists and draft omits link", () => {
  const result = validateRevisionAgainstHardConstraints({
    inboundBody: "Monday morning works for me",
    offeredSlots: [
      { label: "Mon, Feb 16 at 6:30 PM PST", datetime: "2026-02-17T02:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: "https://cal.example.com/book",
    leadSchedulerLink: null,
    draft: "Great, Monday at 6:30 PM PST works. We'll send a calendar invite.",
  });

  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("window_no_match_link_missing")));
});

test("validateRevisionAgainstHardConstraints passes when no window-matching slot exists and draft uses booking link", () => {
  const result = validateRevisionAgainstHardConstraints({
    inboundBody: "Monday morning works for me",
    offeredSlots: [
      { label: "Mon, Feb 16 at 6:30 PM PST", datetime: "2026-02-17T02:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: "https://cal.example.com/book",
    leadSchedulerLink: null,
    draft: "I don't have a matching slot in that window right now. You can grab any open time here: https://cal.example.com/book",
  });

  assert.equal(result.passed, true);
  assert.equal(result.reasons.length, 0);
});

test("buildRevisionHardConstraints treats week-of-month windows as window intent (Mon-Sun semantics)", () => {
  const result = buildRevisionHardConstraints({
    inboundBody: "The 2nd week of March works for me.",
    offeredSlots: [
      { label: "Mon, Mar 16 at 10:00 AM PST", datetime: "2026-03-16T17:00:00.000Z", offeredAt: "2026-03-01T00:00:00.000Z" },
    ],
    bookingLink: "https://cal.example.com/book",
    leadSchedulerLink: null,
  });

  assert.equal(result.preferSingleSlotForWindow, true);
  assert.ok(result.hardRequirements.some((line) => /no offered slot matches the requested window/i.test(line)));
});

test("validateRevisionAgainstHardConstraints fails link-only policy when week-of-month window has no matching slot", () => {
  const result = validateRevisionAgainstHardConstraints({
    inboundBody: "The 2nd week of March works for me.",
    offeredSlots: [
      { label: "Mon, Mar 16 at 10:00 AM PST", datetime: "2026-03-16T17:00:00.000Z", offeredAt: "2026-03-01T00:00:00.000Z" },
    ],
    bookingLink: "https://cal.example.com/book",
    leadSchedulerLink: null,
    draft: "I don't have that week open. Does Mon, Mar 16 at 10:00 AM PST work instead? If not, pick any time here: https://cal.example.com/book",
  });

  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("window_no_match_link_only")));
});
