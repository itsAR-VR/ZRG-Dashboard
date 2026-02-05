import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectOfferedSlotByPreference } from "../meeting-overseer";
import type { OfferedSlot } from "../booking";

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
