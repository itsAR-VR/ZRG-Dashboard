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

test("does not flag slot_mismatch when draft asks a clarifying question without proposing times", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Let's talk next Monday afternoon.",
    draft: "Sounds good. What time next Monday afternoon works best?",
    offeredSlots: [
      { label: "Tue, Feb 17 at 9:00 AM PST", datetime: "2026-02-17T17:00:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
      { label: "Wed, Feb 18 at 1:30 PM PST", datetime: "2026-02-18T21:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.equal(failures.some((entry) => entry.code === "slot_mismatch"), false);
});

test("does not flag slot_mismatch/date_mismatch when confirming a lead-proposed exact time not in offered slots", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Tuesday Feb 17th 10AM PST works for me.",
    draft: "Confirmed for Tue, Feb 17 at 10:00 AM PST.",
    offeredSlots: [
      { label: "Fri, Feb 13 at 12:30 PM PST", datetime: "2026-02-13T20:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
      { label: "Fri, Feb 13 at 1:30 PM PST", datetime: "2026-02-13T21:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.equal(failures.some((entry) => entry.code === "slot_mismatch"), false);
  assert.equal(failures.some((entry) => entry.code === "date_mismatch"), false);
});

test("flags slot_mismatch when draft shifts a lead-proposed exact time", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Tuesday Feb 17 10AM PST works for me.",
    draft: "Confirmed for Tue, Feb 17 at 10:30 AM PST.",
    offeredSlots: [
      { label: "Fri, Feb 13 at 12:30 PM PST", datetime: "2026-02-13T20:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.ok(failures.some((entry) => entry.code === "slot_mismatch"));
});

test("does not flag slot_mismatch when draft asks for an exact start time within a stated window", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Thursday 12-3 works.",
    draft: "What exact start time works for you on Thursday between 12-3pm ET?",
    offeredSlots: [
      { label: "Tue, Feb 17 at 9:00 AM ET", datetime: "2026-02-17T14:00:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
      { label: "Wed, Feb 18 at 1:30 PM ET", datetime: "2026-02-18T18:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.equal(failures.some((entry) => entry.code === "slot_mismatch"), false);
});

test("does not flag slot_mismatch when draft asks for a specific start time within a window", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "I can chat 12 - 3 on Thursday or anytime after 2 Friday.",
    draft: "What specific start time works for you on Thursday (12–3pm ET) or Friday (after 2pm ET)?",
    offeredSlots: [
      { label: "Thu, Feb 19 at 12:30 PM ET", datetime: "2026-02-19T17:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
      { label: "Fri, Feb 20 at 2:30 PM ET", datetime: "2026-02-20T19:30:00.000Z", offeredAt: "2026-02-12T00:00:00.000Z" },
    ],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.equal(failures.some((entry) => entry.code === "slot_mismatch"), false);
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
    draft: "Sounds good - use this link: https://calendar.example.com/chris/15",
    offeredSlots: [],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.equal(failures.some((entry) => entry.code === "fabricated_link"), false);
});

test("does not flag fabricated_link when draft uses 'calendar' in a non-link sense", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "How active is the community?",
    draft: "We run a packed calendar of private events and meetups throughout the year.",
    offeredSlots: [],
    bookingLink: null,
    leadSchedulerLink: null,
  });

  assert.equal(failures.some((entry) => entry.code === "fabricated_link"), false);
});

test("does not flag fabricated_link for non-scheduling URLs when a booking link exists in context", () => {
  const failures = evaluateReplayInvariantFailures({
    inboundBody: "Can you add me on LinkedIn?",
    draft: "Sure - sending a connection request to https://www.linkedin.com/in/example.",
    offeredSlots: [],
    bookingLink: "https://calendly.com/example/intro",
    leadSchedulerLink: null,
  });

  assert.equal(failures.some((entry) => entry.code === "fabricated_link"), false);
});
