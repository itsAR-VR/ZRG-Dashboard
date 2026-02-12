import assert from "node:assert/strict";
import test from "node:test";

import { evaluateReplayInvariantFailures } from "@/lib/ai-replay/invariants";

test("flags empty_draft when generated draft is blank", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Can you send two times this Friday?",
    draft: "   ",
    offeredSlots: [],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.code, "empty_draft");
});

test("flags slot_mismatch when draft proposes non-offered times", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Friday between 12 and 3 PST works. What do you have?",
    draft: "Would 4:30 PM PST or 9:30 PM PST work?",
    offeredSlots: [
      { label: "Fri, Feb 13 at 12:30 PM PST", datetime: "2026-02-13T20:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
      { label: "Fri, Feb 13 at 1:30 PM PST", datetime: "2026-02-13T21:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.ok(failures.some((entry) => entry.code === "slot_mismatch"));
});

test("flags date_mismatch when draft references unsupported date", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Can we do this Friday?",
    draft: "Great, does Feb 20 at 12:30 PM PST work?",
    offeredSlots: [
      { label: "Fri, Feb 13 at 12:30 PM PST", datetime: "2026-02-13T20:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
      { label: "Fri, Feb 13 at 1:30 PM PST", datetime: "2026-02-13T21:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.ok(failures.some((entry) => entry.code === "date_mismatch"));
});

test("flags fabricated_link when draft references link without known source", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Thanks, that sounds good.",
    draft: "Perfect, book here: https://calendar.example.com/chris/15",
    offeredSlots: [],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.ok(failures.some((entry) => entry.code === "fabricated_link"));
});

test("does not flag fabricated_link when link already exists in inbound context", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Use this link please: https://calendar.example.com/chris/15",
    draft: "Sounds good — use this link: https://calendar.example.com/chris/15",
    offeredSlots: [],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.equal(failures.some((entry) => entry.code === "fabricated_link"), false);
});
