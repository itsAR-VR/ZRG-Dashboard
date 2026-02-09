import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { __testing } from "@/lib/calendar-capacity-metrics";

describe("calendar capacity metrics", () => {
  it("computePct returns null when denominator is 0", () => {
    assert.equal(__testing.computePct(0, 0), null);
  });

  it("computePct returns a 0-1 ratio", () => {
    assert.equal(__testing.computePct(5, 15), 0.25);
    assert.equal(__testing.computePct(1, 0), 1);
  });

  it("filterSlotsInWindow filters invalid and out-of-window slots and normalizes to ISO", () => {
    const now = new Date("2026-02-10T00:00:00Z");
    const end = new Date("2026-02-12T00:00:00Z");
    const slots = [
      "not-a-date",
      "2026-02-09T23:00:00Z",
      "2026-02-10T00:00:00Z",
      "2026-02-11T12:00:00Z",
      "2026-02-12T00:00:00Z",
    ];

    const filtered = __testing.filterSlotsInWindow(slots, now, end);

    assert.deepEqual(filtered, [
      new Date("2026-02-10T00:00:00Z").toISOString(),
      new Date("2026-02-11T12:00:00Z").toISOString(),
    ]);
  });
});

