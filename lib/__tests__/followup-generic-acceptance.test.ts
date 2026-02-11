import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OfferedSlot } from "../booking";
import { isLowRiskGenericAcceptance, looksLikeTimeProposalText, processMessageForAutoBooking } from "../followup-engine";
import { isAutoBookingBlockedSentiment } from "../sentiment-shared";

describe("isLowRiskGenericAcceptance", () => {
  it("returns true for a fresh offered slot", () => {
    const nowMs = Date.parse("2026-02-09T00:00:00.000Z");
    const offeredSlot: OfferedSlot = {
      datetime: "2026-02-13T17:00:00.000Z",
      label: "12:00 PM ET on Fri, Feb 13",
      offeredAt: new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString(),
    };

    assert.equal(isLowRiskGenericAcceptance({ offeredSlot, nowMs }), true);
  });

  it("returns false when the offered slot is stale", () => {
    const nowMs = Date.parse("2026-02-09T00:00:00.000Z");
    const offeredSlot: OfferedSlot = {
      datetime: "2026-02-13T17:00:00.000Z",
      label: "12:00 PM ET on Fri, Feb 13",
      offeredAt: new Date(nowMs - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };

    assert.equal(isLowRiskGenericAcceptance({ offeredSlot, nowMs }), false);
  });

  it("returns false when offeredAt is missing/invalid", () => {
    const nowMs = Date.parse("2026-02-09T00:00:00.000Z");

    assert.equal(
      isLowRiskGenericAcceptance({
        offeredSlot: { datetime: "2026-02-13T17:00:00.000Z", label: "slot", offeredAt: "" },
        nowMs,
      }),
      false
    );
    assert.equal(
      isLowRiskGenericAcceptance({
        offeredSlot: { datetime: "2026-02-13T17:00:00.000Z", label: "slot", offeredAt: "nope" },
        nowMs,
      }),
      false
    );
  });
});

describe("looksLikeTimeProposalText", () => {
  it("does not treat generic business phrasing as a time proposal", () => {
    assert.equal(looksLikeTimeProposalText("Next steps are to share more information."), false);
  });

  it("still triggers on obvious time proposal phrases", () => {
    assert.equal(looksLikeTimeProposalText("Next week works for me."), true);
    assert.equal(looksLikeTimeProposalText("Thursday at 3pm"), true);
    assert.equal(looksLikeTimeProposalText("Feb 13"), true);
  });
});

describe("auto-booking sentiment guards", () => {
  it("treats blocked sentiments as blocked, but fails open when sentiment is missing", () => {
    assert.equal(isAutoBookingBlockedSentiment(null), false);
    assert.equal(isAutoBookingBlockedSentiment(undefined), false);
    assert.equal(isAutoBookingBlockedSentiment("Out of Office"), true);
    assert.equal(isAutoBookingBlockedSentiment("Automated Reply"), true);
    assert.equal(isAutoBookingBlockedSentiment("Blacklist"), true);
    assert.equal(isAutoBookingBlockedSentiment("Meeting Requested"), false);
  });

  it("does not attempt auto-booking for blocked sentiments (meta guard, no DB required)", async () => {
    const result = await processMessageForAutoBooking("lead-123", "I'll be out until Monday 2/16", {
      channel: "email",
      messageId: "msg-123",
      sentimentTag: "Out of Office",
    });
    assert.equal(result.booked, false);
    assert.equal(result.context.failureReason, "blocked_sentiment");
  });
});
