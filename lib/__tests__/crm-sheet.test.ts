import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveCrmResponseMode,
  deriveCrmResponseType,
  mapLeadStatusFromSheet,
  mapSentimentTagFromSheet,
  normalizeCrmValue,
} from "../crm-sheet-utils";

describe("CRM Sheet Utils", () => {
  describe("Status mapping", () => {
    it('maps "Qualified" to Lead.status = "qualified"', () => {
      assert.equal(mapLeadStatusFromSheet("Qualified"), "qualified");
    });

    it('maps "Meeting Booked" to Lead.status = "meeting-booked"', () => {
      assert.equal(mapLeadStatusFromSheet("Meeting Booked"), "meeting-booked");
    });

    it('maps unknown values to "new"', () => {
      assert.equal(mapLeadStatusFromSheet("Pipeline - Review"), "new");
    });
  });

  describe("Category mapping", () => {
    it('maps "Meeting Requested" to Lead.sentimentTag', () => {
      assert.equal(mapSentimentTagFromSheet("Meeting Requested"), "Meeting Requested");
    });

    it("handles case-insensitive matching", () => {
      assert.equal(mapSentimentTagFromSheet("interested"), "Interested");
    });

    it('maps "Objection" to Lead.sentimentTag', () => {
      assert.equal(mapSentimentTagFromSheet("Objection"), "Objection");
    });
  });

  describe("Normalize CRM values", () => {
    it("trims strings and returns null for blanks", () => {
      assert.equal(normalizeCrmValue("  hello  "), "hello");
      assert.equal(normalizeCrmValue("   "), null);
      assert.equal(normalizeCrmValue(null), null);
    });
  });

  describe("Response mode derivation", () => {
    it("classifies AI responses", () => {
      assert.equal(deriveCrmResponseMode("ai", null), "AI");
    });

    it("classifies HUMAN responses", () => {
      assert.equal(deriveCrmResponseMode("setter", null), "HUMAN");
      assert.equal(deriveCrmResponseMode(null, "user-1"), "HUMAN");
    });

    it("falls back to UNKNOWN", () => {
      assert.equal(deriveCrmResponseMode(null, null), "UNKNOWN");
    });
  });

  describe("Response type derivation", () => {
    const now = new Date("2026-02-10T00:00:00.000Z");

    it("labels booked leads as meeting requests", () => {
      assert.equal(
        deriveCrmResponseType({ sentimentTag: null, snoozedUntil: null, bookedEvidence: true, now }),
        "MEETING_REQUEST"
      );
    });

    it("labels meeting/call requests as meeting requests", () => {
      assert.equal(
        deriveCrmResponseType({ sentimentTag: "Meeting Requested", snoozedUntil: null, bookedEvidence: false, now }),
        "MEETING_REQUEST"
      );
      assert.equal(
        deriveCrmResponseType({ sentimentTag: "Call Requested", snoozedUntil: null, bookedEvidence: false, now }),
        "MEETING_REQUEST"
      );
    });

    it("labels information requests", () => {
      assert.equal(
        deriveCrmResponseType({ sentimentTag: "Information Requested", snoozedUntil: null, bookedEvidence: false, now }),
        "INFORMATION_REQUEST"
      );
    });

    it("labels objections", () => {
      assert.equal(
        deriveCrmResponseType({ sentimentTag: "Objection", snoozedUntil: null, bookedEvidence: false, now }),
        "OBJECTION"
      );
    });

    it("labels follow-up future when snoozedUntil is in the future", () => {
      assert.equal(
        deriveCrmResponseType({
          sentimentTag: "Follow Up",
          snoozedUntil: new Date("2026-02-12T00:00:00.000Z"),
          bookedEvidence: false,
          now,
        }),
        "FOLLOW_UP_FUTURE"
      );
    });

    it("labels follow-up future for any Follow Up sentiment", () => {
      assert.equal(
        deriveCrmResponseType({ sentimentTag: "Follow Up", snoozedUntil: null, bookedEvidence: false, now }),
        "FOLLOW_UP_FUTURE"
      );
    });

    it("falls back to OTHER when no rule matches", () => {
      assert.equal(
        deriveCrmResponseType({ sentimentTag: "Neutral", snoozedUntil: null, bookedEvidence: false, now }),
        "OTHER"
      );
    });
  });
});
