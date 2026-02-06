import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectEarliestSlotForWeekday } from "../followup-engine";

describe("selectEarliestSlotForWeekday", () => {
  it("returns earliest slot for requested weekday in UTC timezone", () => {
    const slotsUtcIso = [
      "2026-02-10T16:00:00Z", // Tue
      "2026-02-09T09:00:00Z", // Mon
      "2026-02-09T15:00:00Z", // Mon (later)
    ];

    const result = selectEarliestSlotForWeekday({
      slotsUtcIso,
      weekdayToken: "mon",
      timeZone: "UTC",
    });

    assert.equal(result, new Date("2026-02-09T09:00:00Z").toISOString());
  });

  it("handles timezone day rollover when selecting weekday", () => {
    const slotsUtcIso = [
      "2026-02-09T00:30:00Z", // Sun 16:30 in America/Los_Angeles
      "2026-02-09T18:00:00Z", // Mon 10:00 in America/Los_Angeles
    ];

    const result = selectEarliestSlotForWeekday({
      slotsUtcIso,
      weekdayToken: "mon",
      timeZone: "America/Los_Angeles",
    });

    assert.equal(result, new Date("2026-02-09T18:00:00Z").toISOString());
  });

  it("returns null when the weekday token is invalid", () => {
    const result = selectEarliestSlotForWeekday({
      slotsUtcIso: ["2026-02-09T09:00:00Z"],
      weekdayToken: "monday",
      timeZone: "UTC",
    });

    assert.equal(result, null);
  });

  it("returns null when no slots match the requested weekday", () => {
    const result = selectEarliestSlotForWeekday({
      slotsUtcIso: ["2026-02-09T09:00:00Z"],
      weekdayToken: "tue",
      timeZone: "UTC",
    });

    assert.equal(result, null);
  });

  it("prefers slots matching preferredTimeOfDay when available", () => {
    const slotsUtcIso = [
      "2026-02-12T15:00:00Z", // Thu afternoon
      "2026-02-12T08:00:00Z", // Thu morning (earlier)
      "2026-02-11T08:00:00Z", // Wed morning
    ];

    const result = selectEarliestSlotForWeekday({
      slotsUtcIso,
      weekdayToken: "thu",
      timeZone: "UTC",
      preferredTimeOfDay: "morning",
    });

    assert.equal(result, new Date("2026-02-12T08:00:00Z").toISOString());
  });

  it("falls back to weekday-only when preferredTimeOfDay has no matches", () => {
    const slotsUtcIso = [
      "2026-02-12T15:00:00Z", // Thu afternoon (earliest)
      "2026-02-12T18:00:00Z", // Thu evening
    ];

    const result = selectEarliestSlotForWeekday({
      slotsUtcIso,
      weekdayToken: "thu",
      timeZone: "UTC",
      preferredTimeOfDay: "morning",
    });

    assert.equal(result, new Date("2026-02-12T15:00:00Z").toISOString());
  });
});
