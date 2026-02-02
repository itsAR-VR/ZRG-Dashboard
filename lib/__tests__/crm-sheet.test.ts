import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveCrmResponseMode,
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
});
