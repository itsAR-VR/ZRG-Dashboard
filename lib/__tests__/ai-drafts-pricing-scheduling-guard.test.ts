import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPricingAnswerNoSchedulingGuard,
  applyPricingAnswerQualificationGuard,
} from "../ai-drafts";
import type { MeetingOverseerExtractDecision } from "../meeting-overseer";

function buildExtraction(overrides?: Partial<MeetingOverseerExtractDecision>): MeetingOverseerExtractDecision {
  return {
    is_scheduling_related: false,
    intent: "other",
    intent_to_book: false,
    intent_confidence: 0.8,
    acceptance_specificity: "none",
    accepted_slot_index: null,
    preferred_day_of_week: null,
    preferred_time_of_day: null,
    relative_preference: null,
    relative_preference_detail: null,
    qualification_status: "unknown",
    qualification_confidence: 0.7,
    qualification_evidence: [],
    time_from_body_only: false,
    detected_timezone: null,
    time_extraction_confidence: 0.5,
    needs_clarification: false,
    clarification_reason: null,
    needs_pricing_answer: true,
    needs_community_details: false,
    confidence: 0.8,
    evidence: [],
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "yes",
      hasBookingIntent: "no",
      shouldBookNow: "no",
      leadTimezone: "America/Los_Angeles",
      leadProposedWindows: [],
      needsPricingAnswer: "yes",
      needsCommunityDetails: "no",
      responseMode: "info_then_booking",
      evidence: [],
    },
    decision_contract_status: "ok",
    decision_contract_error: null,
    ...overrides,
  };
}

test("applyPricingAnswerNoSchedulingGuard removes scheduling paragraph for pricing-only replies", () => {
  const input = [
    "Hi Jothsna,",
    "",
    "Membership is $9,500 annually. It equates to $791/month for founders exploring before committing annually.",
    "",
    "To make sure it's aligned: are you currently at or above $1M annual revenue?",
    "",
    "If yes, we can walk through fit on a 15-minute call. Does 5:00 PM EST on Mon, Feb 16 or 11:00 AM EST on Tue, Feb 17 work?",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyPricingAnswerNoSchedulingGuard({
    draft: input,
    extraction: buildExtraction(),
  });

  assert.equal(result.changed, true);
  assert.match(result.draft, /\$9,500 annually/);
  assert.match(result.draft, /\$1M annual revenue/);
  assert.ok(!/5:00 PM EST|11:00 AM EST|15-minute call/i.test(result.draft));
});

test("applyPricingAnswerQualificationGuard collapses multi-criteria qualifier and keeps one next step", () => {
  const input = [
    "Hi Jothsna,",
    "",
    "Membership is $9,500 annually, with a flexible option that equates to $791/month.",
    "",
    "To make sure it's aligned: are you currently at or above the $1M annual revenue mark with Gifted Gabber? If not, have you had a $2.5M+ exit or raised $2.5M+?",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyPricingAnswerQualificationGuard({
    draft: input,
    extraction: buildExtraction(),
  });

  assert.equal(result.changed, true);
  assert.match(result.draft, /\$1M annual revenue mark/);
  assert.ok(!/\$2\.5M\+ exit|raised \$2\.5M\+/i.test(result.draft));
  assert.match(result.draft, /quick 15-minute call/i);
});

test("pricing guards do not modify shouldBookNow confirmations", () => {
  const input = "Hi,\n\nBooked for Friday 12:30 PM PST.\n\nBest,\nChris";

  const extraction = buildExtraction({
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "yes",
      hasBookingIntent: "yes",
      shouldBookNow: "yes",
      leadTimezone: "America/Los_Angeles",
      leadProposedWindows: [],
      needsPricingAnswer: "yes",
      needsCommunityDetails: "no",
      responseMode: "booking_only",
      evidence: [],
    },
  });

  const noSchedulingResult = applyPricingAnswerNoSchedulingGuard({ draft: input, extraction });
  const qualificationResult = applyPricingAnswerQualificationGuard({ draft: input, extraction });

  assert.equal(noSchedulingResult.changed, false);
  assert.equal(noSchedulingResult.draft, input);
  assert.equal(qualificationResult.changed, false);
  assert.equal(qualificationResult.draft, input);
});
