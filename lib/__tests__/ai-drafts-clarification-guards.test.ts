import assert from "node:assert/strict";
import test from "node:test";

import {
  applyInfoThenBookingNoTimeRequestGuard,
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

