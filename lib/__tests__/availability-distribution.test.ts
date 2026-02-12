import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectDistributedAvailabilitySlots } from "../availability-distribution";

describe("selectDistributedAvailabilitySlots", () => {
  it("enforces lead-local business-hour boundaries (07:00 inclusive, 21:00 exclusive)", () => {
    const slot0700 = new Date("2026-02-12T03:00:00Z").toISOString(); // 07:00 Asia/Dubai
    const slot2059 = new Date("2026-02-12T16:59:00Z").toISOString(); // 20:59 Asia/Dubai
    const slot2100 = new Date("2026-02-12T17:00:00Z").toISOString(); // 21:00 Asia/Dubai

    const selected = selectDistributedAvailabilitySlots({
      slotsUtcIso: [slot0700, slot2059, slot2100],
      offeredCountBySlotUtcIso: new Map(),
      timeZone: "Asia/Dubai",
      leadTimeZone: "Asia/Dubai",
      now: new Date("2026-02-11T00:00:00Z"),
      preferWithinDays: 5,
    });

    assert.equal(selected.includes(slot2100), false);
    assert.equal(selected.includes(slot0700), true);
    assert.equal(selected.includes(slot2059), true);
  });

  it("fails open when lead-local business-hours filtering removes all candidates", () => {
    const slot2200 = new Date("2026-02-12T18:00:00Z").toISOString(); // 22:00 Asia/Dubai
    const slot2330 = new Date("2026-02-12T19:30:00Z").toISOString(); // 23:30 Asia/Dubai

    const selected = selectDistributedAvailabilitySlots({
      slotsUtcIso: [slot2200, slot2330],
      offeredCountBySlotUtcIso: new Map(),
      timeZone: "Asia/Dubai",
      leadTimeZone: "Asia/Dubai",
      now: new Date("2026-02-11T00:00:00Z"),
      preferWithinDays: 5,
    });

    assert.equal(selected.length > 0, true);
  });
});
