import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MeetingOverseerExtractDecision } from "../meeting-overseer";
import { deriveBookingSignal } from "../followup-engine";

function buildDecision(overrides: Partial<MeetingOverseerExtractDecision>): MeetingOverseerExtractDecision {
  return {
    is_scheduling_related: true,
    intent: "other",
    intent_to_book: false,
    intent_confidence: 1,
    acceptance_specificity: "none",
    accepted_slot_index: null,
    preferred_day_of_week: null,
    preferred_time_of_day: null,
    relative_preference: null,
    relative_preference_detail: null,
    qualification_status: "unknown",
    qualification_confidence: 1,
    qualification_evidence: [],
    time_from_body_only: true,
    time_extraction_confidence: 1,
    needs_clarification: false,
    clarification_reason: null,
    confidence: 1,
    evidence: [],
    ...overrides,
  };
}

describe("deriveBookingSignal", () => {
  it("routes accept_offer when scheduling-related and offered slots exist", () => {
    const decision = buildDecision({ is_scheduling_related: true, intent: "accept_offer", acceptance_specificity: "generic" });
    assert.deepEqual(deriveBookingSignal({ overseerDecision: decision, hasOfferedSlots: true }), {
      wantsToBook: true,
      route: "accept_offered",
      preferredDayOfWeek: null,
      preferredTimeOfDay: null,
    });
  });

  it("does not book when not scheduling-related / decline / other", () => {
    assert.equal(deriveBookingSignal({ overseerDecision: buildDecision({ is_scheduling_related: false }), hasOfferedSlots: true }).wantsToBook, false);
    assert.equal(deriveBookingSignal({ overseerDecision: buildDecision({ intent: "decline" }), hasOfferedSlots: true }).wantsToBook, false);
    assert.equal(deriveBookingSignal({ overseerDecision: buildDecision({ intent: "other" }), hasOfferedSlots: true }).wantsToBook, false);
  });

  it("routes proposed_time when lead proposes a time", () => {
    const decision = buildDecision({ intent: "propose_time" });
    assert.deepEqual(deriveBookingSignal({ overseerDecision: decision, hasOfferedSlots: false }), {
      wantsToBook: true,
      route: "proposed_time",
      preferredDayOfWeek: null,
      preferredTimeOfDay: null,
    });
  });

  it("routes day_only when propose_time is day-only with a weekday token", () => {
    const decision = buildDecision({ intent: "propose_time", acceptance_specificity: "day_only", preferred_day_of_week: "thu" });
    assert.deepEqual(deriveBookingSignal({ overseerDecision: decision, hasOfferedSlots: false }), {
      wantsToBook: true,
      route: "day_only",
      preferredDayOfWeek: "thu",
      preferredTimeOfDay: null,
    });
  });

  it("treats request_times and reschedule as non-booking routes", () => {
    assert.equal(deriveBookingSignal({ overseerDecision: buildDecision({ intent: "request_times" }), hasOfferedSlots: false }).wantsToBook, false);
    assert.equal(deriveBookingSignal({ overseerDecision: buildDecision({ intent: "reschedule" }), hasOfferedSlots: false }).wantsToBook, false);
  });

  it("fails closed when overseer is null", () => {
    assert.deepEqual(deriveBookingSignal({ overseerDecision: null, hasOfferedSlots: true }), {
      wantsToBook: false,
      route: "none",
      preferredDayOfWeek: null,
      preferredTimeOfDay: null,
    });
  });

  it("carries through weekday/time-of-day preferences for downstream routing", () => {
    const decision = buildDecision({
      intent: "accept_offer",
      acceptance_specificity: "day_only",
      preferred_day_of_week: "thu",
      preferred_time_of_day: "morning",
    });
    const signal = deriveBookingSignal({ overseerDecision: decision, hasOfferedSlots: true });
    assert.equal(signal.route, "accept_offered");
    assert.equal(signal.preferredDayOfWeek, "thu");
    assert.equal(signal.preferredTimeOfDay, "morning");
  });
});
