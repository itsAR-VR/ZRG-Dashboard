import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectSnoozedUntilUtcFromMessage } from "@/lib/snooze-detection";

describe("detectSnoozedUntilUtcFromMessage", () => {
  it("parses quarter without year to next future quarter start at 9am local", () => {
    const now = new Date("2026-02-19T12:00:00.000Z");
    const result = detectSnoozedUntilUtcFromMessage({
      messageText: "I am busy, circle back in Q3",
      now,
      timeZone: "America/Chicago",
    });

    assert.ok(result.snoozedUntilUtc);
    assert.equal(result.snoozedUntilUtc?.toISOString(), "2026-07-01T14:00:00.000Z");
  });

  it("parses quarter with explicit year", () => {
    const now = new Date("2026-02-19T12:00:00.000Z");
    const result = detectSnoozedUntilUtcFromMessage({
      messageText: "Please circle back in Q3 2027",
      now,
      timeZone: "America/Chicago",
    });

    assert.ok(result.snoozedUntilUtc);
    assert.equal(result.snoozedUntilUtc?.toISOString(), "2027-07-01T14:00:00.000Z");
  });

  it("keeps existing month/day behavior", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const result = detectSnoozedUntilUtcFromMessage({
      messageText: "Please follow up after Jan 13",
      now,
      timeZone: "America/Chicago",
    });

    assert.ok(result.snoozedUntilUtc);
    assert.equal(result.snoozedUntilUtc?.toISOString(), "2026-01-13T15:00:00.000Z");
  });

  it("does not match non-scheduling quarter phrasing", () => {
    const result = detectSnoozedUntilUtcFromMessage({
      messageText: "We are discussing quarterly billing options",
      now: new Date("2026-02-19T12:00:00.000Z"),
      timeZone: "America/Chicago",
    });

    assert.equal(result.snoozedUntilUtc, null);
  });
});
