import assert from "node:assert/strict";
import test from "node:test";

import {
  applyClarifyOnlyWindowStartTimeGuard,
  applyInfoThenBookingNoTimeRequestGuard,
  applyInfoThenBookingNoQualificationGatingGuard,
  applyInfoThenBookingNoQualificationQuestionGuard,
  applyTimezoneQuestionSuppressionGuard,
} from "../ai-drafts";
import type { MeetingOverseerExtractDecision } from "../meeting-overseer";

function buildExtraction(overrides?: Partial<MeetingOverseerExtractDecision>): MeetingOverseerExtractDecision {
  return {
    is_scheduling_related: true,
    intent: "propose_time",
    intent_to_book: true,
    intent_confidence: 0.8,
    acceptance_specificity: "day_only",
    accepted_slot_index: null,
    preferred_day_of_week: "tue",
    preferred_time_of_day: null,
    relative_preference: null,
    relative_preference_detail: null,
    qualification_status: "unknown",
    qualification_confidence: 0.6,
    qualification_evidence: [],
    time_from_body_only: true,
    detected_timezone: "America/Los_Angeles",
    time_extraction_confidence: 0.7,
    needs_clarification: true,
    clarification_reason: "needs_start_time",
    needs_pricing_answer: false,
    needs_community_details: false,
    confidence: 0.8,
    evidence: [],
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "no",
      hasBookingIntent: "yes",
      shouldBookNow: "no",
      leadTimezone: "America/Los_Angeles",
      leadProposedWindows: [{ type: "day_only", value: "tue", detail: null }],
      needsPricingAnswer: "no",
      needsCommunityDetails: "no",
      responseMode: "clarify_only",
      evidence: [],
    },
    decision_contract_status: "ok",
    decision_contract_error: null,
    ...overrides,
  };
}

test("applyTimezoneQuestionSuppressionGuard removes standalone timezone question when timezone is known", () => {
  const input = ["Hi Dan,", "", "Got it. What time zone should we book in?", "", "Best,", "Chris"].join("\n");
  const result = applyTimezoneQuestionSuppressionGuard({
    draft: input,
    extraction: buildExtraction({
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        leadTimezone: "America/Chicago",
      },
      detected_timezone: "America/Chicago",
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(!/time\s*zone/i.test(result.draft));
});

test("applyTimezoneQuestionSuppressionGuard removes inline timezone add-on inside a broader question", () => {
  const input = [
    "Hi Cellene,",
    "",
    "What time on Tuesday works best for a quick chat (and what timezone should we use)?",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyTimezoneQuestionSuppressionGuard({
    draft: input,
    extraction: buildExtraction({
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        leadTimezone: "America/Los_Angeles",
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.match(result.draft, /What time on Tuesday works best/i);
  assert.ok(!/timezone should we use/i.test(result.draft));
});

test("applyInfoThenBookingNoTimeRequestGuard removes time-picking request when lead wants info first", () => {
  const input = [
    "Hi Monica,",
    "",
    "Here are a few details about membership.",
    "",
    "To make sure it's aligned: are you at or above $1M annual revenue?",
    "",
    "If so, what 2-3 times (ET) work for a quick 15-minute chat?",
    "",
    "Best,",
    "Aaron",
  ].join("\n");

  const result = applyInfoThenBookingNoTimeRequestGuard({
    draft: input,
    extraction: buildExtraction({
      needs_clarification: false,
      decision_contract_v1: {
        contractVersion: "v1",
        isQualified: "no",
        hasBookingIntent: "no",
        shouldBookNow: "no",
        leadTimezone: "America/New_York",
        leadProposedWindows: [],
        needsPricingAnswer: "no",
        needsCommunityDetails: "yes",
        responseMode: "info_then_booking",
        evidence: [],
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(!/what 2-3 times/i.test(result.draft));
  assert.match(result.draft, /\$1M annual revenue/);
});

test("applyClarifyOnlyWindowStartTimeGuard rewrites anchored time question into an exact start-time question", () => {
  const input = [
    "Hi Cellene,",
    "",
    "Pricing is $9,500/year.",
    "",
    "For timing, does Tuesday the 17th at 10:00am Pacific work for a 15-minute chat?",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyClarifyOnlyWindowStartTimeGuard({
    draft: input,
    extraction: buildExtraction({
      evidence: ["“a chat Tuesday 17th after 10am works for me.”"],
      needs_clarification: true,
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        responseMode: "clarify_only",
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(!/10:00am/i.test(result.draft));
  assert.match(result.draft, /What exact start time on Tuesday the 17th \(after 10am Pacific\)/i);
});

test("applyInfoThenBookingNoTimeRequestGuard removes explicit time options even when not phrased as a question", () => {
  const input = [
    "Hi Shane,",
    "",
    "Membership includes mastermind groups and a 24/7 member network.",
    "",
    "If it’s helpful, we can walk through it on a quick 15-minute call. Two options are 11:30 AM EST on Tue, Feb 17 or 4:00 PM EST on Wed, Feb 18.",
    "",
    "https://calendly.com/example/intro",
    "",
    "Which time works?",
    "",
    "Best,",
    "Aaron",
  ].join("\n");

  const extraction = buildExtraction({
    needs_clarification: false,
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "no",
      hasBookingIntent: "no",
      shouldBookNow: "no",
      leadTimezone: "America/Denver",
      leadProposedWindows: [],
      needsPricingAnswer: "no",
      needsCommunityDetails: "yes",
      responseMode: "info_then_booking",
      evidence: [],
    },
  });

  const result = applyInfoThenBookingNoTimeRequestGuard({ draft: input, extraction });
  assert.equal(result.changed, true);
  assert.ok(!/Two options are/i.test(result.draft));
  assert.ok(!/Which time works/i.test(result.draft));
  assert.match(result.draft, /calendly\\.com\\/example\\/intro/i);
});

test("applyInfoThenBookingNoQualificationGatingGuard removes qualification gating clause when pricing isn't requested", () => {
  const input = [
    "Hi Shane,",
    "",
    "Membership is a private community for founders/operators doing $1M+ in annual revenue, with a mix of online access and in-person programming.",
    "",
    "Best,",
    "Aaron",
  ].join("\n");

  const extraction = buildExtraction({
    needs_clarification: false,
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "no",
      hasBookingIntent: "no",
      shouldBookNow: "no",
      leadTimezone: "America/Denver",
      leadProposedWindows: [],
      needsPricingAnswer: "no",
      needsCommunityDetails: "yes",
      responseMode: "info_then_booking",
      evidence: [],
    },
  });

  const result = applyInfoThenBookingNoQualificationGatingGuard({ draft: input, extraction });
  assert.equal(result.changed, true);
  assert.ok(!/\\$1M\\+\\s+in\\s+annual\\s+revenue/i.test(result.draft));
  assert.match(result.draft, /for founders\\/operators, with a mix/i);
});

test("applyInfoThenBookingNoQualificationQuestionGuard removes revenue gating questions in info_then_booking", () => {
  const input = [
    "Hi Monica,",
    "",
    "Membership includes masterminds and a 24/7 member network.",
    "",
    "To make sure it's aligned: are you currently at or above the $1m annual revenue mark?",
    "If yes, we can do a quick 15-minute call to walk through details.",
    "",
    "Best,",
    "Aaron",
  ].join("\n");

  const extraction = buildExtraction({
    needs_clarification: false,
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "no",
      hasBookingIntent: "no",
      shouldBookNow: "no",
      leadTimezone: "America/New_York",
      leadProposedWindows: [],
      needsPricingAnswer: "no",
      needsCommunityDetails: "yes",
      responseMode: "info_then_booking",
      evidence: [],
    },
  });

  const result = applyInfoThenBookingNoQualificationQuestionGuard({ draft: input, extraction });
  assert.equal(result.changed, true);
  assert.ok(!/annual revenue/i.test(result.draft));
  assert.match(result.draft, /If helpful, we can do a quick 15-minute call/i);
});
