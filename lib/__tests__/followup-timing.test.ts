import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildScheduledFollowUpMessage, zonedLocalDateTimeToUtc } from "@/lib/followup-timing";

describe("followup-timing helpers", () => {
  it("builds a follow-up message with first name fallback", () => {
    assert.equal(
      buildScheduledFollowUpMessage("Ari"),
      "Hey Ari - circling back like you suggested. Is now a better time to revisit this?"
    );
    assert.equal(
      buildScheduledFollowUpMessage(""),
      "Hey there - circling back like you suggested. Is now a better time to revisit this?"
    );
  });

  it("converts local time to UTC with timezone", () => {
    const utc = zonedLocalDateTimeToUtc({
      year: 2026,
      month: 7,
      day: 1,
      hour: 9,
      minute: 0,
      timeZone: "America/Chicago",
    });
    assert.ok(utc);
    assert.equal(utc?.toISOString(), "2026-07-01T14:00:00.000Z");
  });
});
