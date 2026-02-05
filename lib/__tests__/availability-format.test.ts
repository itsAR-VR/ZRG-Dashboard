import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatAvailabilitySlotLabel, formatAvailabilitySlots } from "../availability-format";

describe("formatAvailabilitySlotLabel", () => {
  it("throws for missing or invalid datetime", () => {
    assert.throws(() => formatAvailabilitySlotLabel({ datetimeUtcIso: "", timeZone: "UTC", mode: "explicit_tz" }));
    assert.throws(() =>
      formatAvailabilitySlotLabel({ datetimeUtcIso: "not-a-date", timeZone: "UTC", mode: "explicit_tz" })
    );
  });
});

describe("formatAvailabilitySlots", () => {
  it("skips blank or invalid slots", () => {
    const slots = ["", "not-a-date", "2026-02-12T15:00:00Z"];
    const formatted = formatAvailabilitySlots({
      slotsUtcIso: slots,
      timeZone: "America/New_York",
      mode: "explicit_tz",
      limit: 3,
    });

    assert.equal(formatted.length, 1);
    assert.equal(formatted[0]?.datetime, new Date("2026-02-12T15:00:00Z").toISOString());
    assert.ok(formatted[0]?.label.includes("on"));
  });
});
