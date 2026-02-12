import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveAIDecisionContractV1FromExtraction,
  repairAIDecisionContractV1,
  validateAIDecisionContractV1,
} from "../ai/decision-contract";

const baseExtraction = {
  is_scheduling_related: true,
  intent_to_book: true,
  qualification_status: "qualified" as const,
  preferred_day_of_week: "fri",
  preferred_time_of_day: "afternoon",
  relative_preference: null,
  relative_preference_detail: null,
  needs_clarification: false,
  detected_timezone: "America/Los_Angeles",
  evidence: ["Lead asks to chat Friday afternoon"],
  qualification_evidence: ["Lead confirms revenue threshold"],
};

describe("ai decision contract v1", () => {
  it("derives booking_only contract for qualified booking intent", () => {
    const contract = deriveAIDecisionContractV1FromExtraction({
      extraction: baseExtraction,
      messageText: "Friday 12-3pm PST works for me",
    });

    assert.equal(contract.contractVersion, "v1");
    assert.equal(contract.isQualified, "yes");
    assert.equal(contract.hasBookingIntent, "yes");
    assert.equal(contract.shouldBookNow, "yes");
    assert.equal(contract.responseMode, "booking_only");
    assert.equal(contract.leadTimezone, "America/Los_Angeles");
    assert.ok(contract.leadProposedWindows.length >= 1);
  });

  it("derives info_then_booking when pricing is asked but booking-now is not ready", () => {
    const contract = deriveAIDecisionContractV1FromExtraction({
      extraction: {
        ...baseExtraction,
        intent_to_book: false,
        needs_clarification: false,
      },
      messageText: "What is the monthly pricing before we schedule?",
    });

    assert.equal(contract.hasBookingIntent, "no");
    assert.equal(contract.needsPricingAnswer, "yes");
    assert.equal(contract.responseMode, "info_then_booking");
  });

  it("validates strict yes/no and mode fields", () => {
    const valid = validateAIDecisionContractV1({
      contractVersion: "v1",
      isQualified: "yes",
      hasBookingIntent: "no",
      shouldBookNow: "no",
      leadTimezone: null,
      leadProposedWindows: [],
      needsPricingAnswer: "no",
      needsCommunityDetails: "no",
      responseMode: "clarify_only",
      evidence: [],
    });
    assert.equal(valid.success, true);

    const invalid = validateAIDecisionContractV1({
      contractVersion: "v1",
      isQualified: "maybe",
      hasBookingIntent: "no",
      shouldBookNow: "no",
      leadTimezone: null,
      leadProposedWindows: [],
      needsPricingAnswer: "no",
      needsCommunityDetails: "no",
      responseMode: "clarify_only",
      evidence: [],
    });
    assert.equal(invalid.success, false);
  });

  it("repairs loose payload types into valid contract", () => {
    const repaired = repairAIDecisionContractV1({
      contractVersion: "v0",
      isQualified: true,
      hasBookingIntent: "true",
      shouldBookNow: "false",
      leadTimezone: 123,
      leadProposedWindows: [{ type: "day_only", value: "fri", detail: "" }],
      needsPricingAnswer: false,
      needsCommunityDetails: 0,
      responseMode: "unknown_mode",
      evidence: ["a", 1, "b"],
    });

    assert.ok(repaired);
    const validated = validateAIDecisionContractV1(repaired);
    assert.equal(validated.success, true);
    assert.equal(repaired?.contractVersion, "v1");
    assert.equal(repaired?.isQualified, "yes");
    assert.equal(repaired?.responseMode, "clarify_only");
    assert.equal(repaired?.leadTimezone, null);
  });
});
