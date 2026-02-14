import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { repairShouldBookNowAgainstOfferedSlots, selectOfferedSlotByPreference, shouldRunMeetingOverseer } from "../meeting-overseer";
import type { OfferedSlot } from "../booking";
import type { MeetingOverseerExtractDecision } from "../meeting-overseer";

describe("selectOfferedSlotByPreference", () => {
  it("selects a slot matching the preferred weekday", () => {
    const offeredSlots: OfferedSlot[] = [
      {
        datetime: "2026-02-12T15:00:00Z", // Thu 10:00 ET
        label: "Thu 10am ET",
        offeredAt: "2026-02-05T00:00:00Z",
      },
      {
        datetime: "2026-02-13T15:00:00Z", // Fri 10:00 ET
        label: "Fri 10am ET",
        offeredAt: "2026-02-05T00:00:00Z",
      },
    ];

    const selected = selectOfferedSlotByPreference({
      offeredSlots,
      timeZone: "America/New_York",
      preferredDayOfWeek: "thu",
    });

    assert.equal(selected?.datetime, offeredSlots[0].datetime);
  });

  it("selects the earliest slot matching time-of-day", () => {
    const offeredSlots: OfferedSlot[] = [
      {
        datetime: "2026-02-12T14:00:00Z", // Thu 9:00 ET
        label: "Thu 9am ET",
        offeredAt: "2026-02-05T00:00:00Z",
      },
      {
        datetime: "2026-02-12T21:00:00Z", // Thu 4:00 ET
        label: "Thu 4pm ET",
        offeredAt: "2026-02-05T00:00:00Z",
      },
    ];

    const selected = selectOfferedSlotByPreference({
      offeredSlots,
      timeZone: "America/New_York",
      preferredTimeOfDay: "morning",
    });

    assert.equal(selected?.datetime, offeredSlots[0].datetime);
  });
});

describe("repairShouldBookNowAgainstOfferedSlots", () => {
  it("sets accepted_slot_index when shouldBookNow=yes and a preferred slot exists", () => {
    const offeredSlots: OfferedSlot[] = [
      {
        datetime: "2026-02-12T21:00:00Z", // Thu 4:00 ET
        label: "Thu 4pm ET",
        offeredAt: "2026-02-05T00:00:00Z",
      },
      {
        datetime: "2026-02-12T18:00:00Z", // Thu 1:00 ET
        label: "Thu 1pm ET",
        offeredAt: "2026-02-05T00:00:00Z",
      },
    ];

    const decision: MeetingOverseerExtractDecision = {
      is_scheduling_related: true,
      intent: "propose_time",
      intent_to_book: true,
      intent_confidence: 0.9,
      acceptance_specificity: "day_only",
      accepted_slot_index: null,
      preferred_day_of_week: "thu",
      preferred_time_of_day: "afternoon",
      relative_preference: null,
      relative_preference_detail: null,
      qualification_status: "qualified",
      qualification_confidence: 0.9,
      qualification_evidence: [],
      time_from_body_only: true,
      detected_timezone: "America/New_York",
      time_extraction_confidence: 0.9,
      needs_clarification: false,
      clarification_reason: null,
      needs_pricing_answer: false,
      needs_community_details: false,
      confidence: 0.9,
      evidence: [],
      decision_contract_v1: {
        contractVersion: "v1",
        isQualified: "yes",
        hasBookingIntent: "yes",
        shouldBookNow: "yes",
        leadTimezone: "America/New_York",
        leadProposedWindows: [{ type: "day_only", value: "thu", detail: null }],
        needsPricingAnswer: "no",
        needsCommunityDetails: "no",
        responseMode: "booking_only",
        evidence: [],
      },
      decision_contract_status: "ok",
      decision_contract_error: null,
    };

    const repaired = repairShouldBookNowAgainstOfferedSlots({ decision, offeredSlots, leadTimezoneHint: "America/New_York" });

    // Thu afternoon earliest is 1pm ET, which is index 2 in the input.
    assert.equal(repaired.accepted_slot_index, 2);
    assert.equal(repaired.needs_clarification, false);
    assert.equal(repaired.decision_contract_v1?.shouldBookNow, "yes");
  });

  it("uses an evidence start-time constraint (e.g., 10am) to avoid booking an earlier slot", () => {
    const offeredSlots: OfferedSlot[] = [
      {
        datetime: "2026-02-17T14:00:00Z", // Tue 9:00 ET
        label: "Tue 9am ET",
        offeredAt: "2026-02-05T00:00:00Z",
      },
      {
        datetime: "2026-02-17T18:30:00Z", // Tue 1:30 ET
        label: "Tue 1:30pm ET",
        offeredAt: "2026-02-05T00:00:00Z",
      },
    ];

    const decision: MeetingOverseerExtractDecision = {
      is_scheduling_related: true,
      intent: "propose_time",
      intent_to_book: true,
      intent_confidence: 0.9,
      acceptance_specificity: "day_only",
      accepted_slot_index: null,
      preferred_day_of_week: "tue",
      preferred_time_of_day: null,
      relative_preference: null,
      relative_preference_detail: null,
      qualification_status: "qualified",
      qualification_confidence: 0.9,
      qualification_evidence: [],
      time_from_body_only: true,
      detected_timezone: "America/New_York",
      time_extraction_confidence: 0.9,
      needs_clarification: false,
      clarification_reason: null,
      needs_pricing_answer: false,
      needs_community_details: false,
      confidence: 0.9,
      evidence: ["Tuesday after 10am works for me."],
      decision_contract_v1: {
        contractVersion: "v1",
        isQualified: "yes",
        hasBookingIntent: "yes",
        shouldBookNow: "yes",
        leadTimezone: "America/New_York",
        leadProposedWindows: [{ type: "day_only", value: "tue", detail: null }],
        needsPricingAnswer: "no",
        needsCommunityDetails: "no",
        responseMode: "booking_only",
        evidence: [],
      },
      decision_contract_status: "ok",
      decision_contract_error: null,
    };

    const repaired = repairShouldBookNowAgainstOfferedSlots({ decision, offeredSlots, leadTimezoneHint: "America/New_York" });

    // 10am constraint should prefer 1:30pm over 9am.
    assert.equal(repaired.accepted_slot_index, 2);
  });

  it("degrades shouldBookNow=yes into clarify_only when no offered slot matches the lead's window", () => {
    const offeredSlots: OfferedSlot[] = [
      {
        datetime: "2026-02-10T15:00:00Z", // Tue 10:00 ET
        label: "Tue 10am ET",
        offeredAt: "2026-02-05T00:00:00Z",
      },
    ];

    const decision: MeetingOverseerExtractDecision = {
      is_scheduling_related: true,
      intent: "propose_time",
      intent_to_book: true,
      intent_confidence: 0.9,
      acceptance_specificity: "day_only",
      accepted_slot_index: null,
      preferred_day_of_week: "thu",
      preferred_time_of_day: "afternoon",
      relative_preference: null,
      relative_preference_detail: null,
      qualification_status: "qualified",
      qualification_confidence: 0.9,
      qualification_evidence: [],
      time_from_body_only: true,
      detected_timezone: "America/New_York",
      time_extraction_confidence: 0.9,
      needs_clarification: false,
      clarification_reason: null,
      needs_pricing_answer: false,
      needs_community_details: false,
      confidence: 0.9,
      evidence: [],
      decision_contract_v1: {
        contractVersion: "v1",
        isQualified: "yes",
        hasBookingIntent: "yes",
        shouldBookNow: "yes",
        leadTimezone: "America/New_York",
        leadProposedWindows: [{ type: "day_only", value: "thu", detail: null }],
        needsPricingAnswer: "no",
        needsCommunityDetails: "no",
        responseMode: "booking_only",
        evidence: [],
      },
      decision_contract_status: "ok",
      decision_contract_error: null,
    };

    const repaired = repairShouldBookNowAgainstOfferedSlots({ decision, offeredSlots, leadTimezoneHint: "America/New_York" });

    assert.equal(repaired.needs_clarification, true);
    assert.equal(repaired.decision_contract_v1?.shouldBookNow, "no");
    assert.equal(repaired.decision_contract_v1?.responseMode, "clarify_only");
  });
});

describe("shouldRunMeetingOverseer", () => {
  it("does not run for blocked sentiments even if the message contains scheduling keywords", () => {
    assert.equal(
      shouldRunMeetingOverseer({ messageText: "Monday works for me", sentimentTag: "Out of Office" }),
      false
    );
    assert.equal(
      shouldRunMeetingOverseer({ messageText: "Thursday at 3pm", sentimentTag: "Automated Reply" }),
      false
    );
    assert.equal(
      shouldRunMeetingOverseer({ messageText: "Next week is great", sentimentTag: "Blacklist" }),
      false
    );
  });

  it("does not run for blocked sentiments even when offered slots exist", () => {
    assert.equal(
      shouldRunMeetingOverseer({ messageText: "Sure", sentimentTag: "Out of Office", offeredSlotsCount: 3 }),
      false
    );
  });

  it("still runs for positive/unknown sentiment when appropriate", () => {
    assert.equal(shouldRunMeetingOverseer({ messageText: "Monday works", sentimentTag: "Meeting Requested" }), true);
    assert.equal(shouldRunMeetingOverseer({ messageText: "What time works for you?", sentimentTag: null }), true);
    assert.equal(shouldRunMeetingOverseer({ messageText: "How much does the membership cost?", sentimentTag: null }), true);
  });
});
