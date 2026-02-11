import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectOfferedSlotByPreference, shouldRunMeetingOverseer } from "../meeting-overseer";
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

describe("shouldRunMeetingOverseer", () => {
  it("does not run for blocked sentiments even if the message contains scheduling keywords", () => {
    assert.equal(
      shouldRunMeetingOverseer({ messageText: "Monday works for me", sentimentTag: "Out of Office" }),
      false
    );
    assert.equal(
      shouldRunMeetingOverseer({ messageText: "Thursday at 3pm", sentimentTag: "Automated Reply" }),
      false
    );
    assert.equal(
      shouldRunMeetingOverseer({ messageText: "Next week is great", sentimentTag: "Blacklist" }),
      false
    );
  });

  it("does not run for blocked sentiments even when offered slots exist", () => {
    assert.equal(
      shouldRunMeetingOverseer({ messageText: "Sure", sentimentTag: "Out of Office", offeredSlotsCount: 3 }),
      false
    );
  });

  it("still runs for positive/unknown sentiment when appropriate", () => {
    assert.equal(shouldRunMeetingOverseer({ messageText: "Monday works", sentimentTag: "Meeting Requested" }), true);
    assert.equal(shouldRunMeetingOverseer({ messageText: "What time works for you?", sentimentTag: null }), true);
  });
});
