import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countSlotsInWorkspaceWindow } from "../calendar-health";

describe("calendar-health", () => {
  it("counts only weekday slots within working hours for the next 7 days", () => {
    const now = new Date("2026-02-02T16:00:00Z"); // Mon (ET)

    const result = countSlotsInWorkspaceWindow({
      slotsUtcIso: [
        "2026-02-02T14:00:00Z", // 09:00 ET (include)
        "2026-02-02T15:00:00Z", // 10:00 ET (include)
        "2026-02-02T15:00:00Z", // duplicate (should dedupe)
        "2026-02-02T22:00:00Z", // 17:00 ET (exclude, end boundary)
        "2026-02-02T23:00:00Z", // 18:00 ET (exclude)
        "2026-02-07T15:00:00Z", // Sat 10:00 ET (exclude, weekend)
        "2026-02-09T15:00:00Z", // Next Mon 10:00 ET (exclude, outside 7-day window)
      ],
      timeZone: "America/New_York",
      windowDays: 7,
      workStartTime: "09:00",
      workEndTime: "17:00",
      weekdaysOnly: true,
      now,
    });

    assert.equal(result.total, 2);
    assert.deepEqual(result.byDate, { "2026-02-02": 2 });
  });

  it("falls back to ET when timezone is invalid", () => {
    const now = new Date("2026-02-02T16:00:00Z"); // Mon (ET)

    const result = countSlotsInWorkspaceWindow({
      slotsUtcIso: ["2026-02-02T15:00:00Z"], // 10:00 ET
      timeZone: "Not/AZone",
      windowDays: 7,
      workStartTime: "09:00",
      workEndTime: "17:00",
      weekdaysOnly: true,
      now,
    });

    assert.equal(result.total, 1);
    assert.deepEqual(result.byDate, { "2026-02-02": 1 });
  });

  it("handles DST boundary weeks without throwing", () => {
    // US DST starts Mar 8, 2026 (America/New_York). On Mar 9, 09:00 local is 13:00Z (UTC-4).
    const now = new Date("2026-03-07T17:00:00Z"); // Sat

    const result = countSlotsInWorkspaceWindow({
      slotsUtcIso: ["2026-03-09T13:00:00Z"], // Mon 09:00 ET (EDT)
      timeZone: "America/New_York",
      windowDays: 7,
      workStartTime: "09:00",
      workEndTime: "17:00",
      weekdaysOnly: true,
      now,
    });

    assert.equal(result.total, 1);
    assert.deepEqual(result.byDate, { "2026-03-09": 1 });
  });
});

