import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRefreshCandidates, detectPreferredTimezoneToken } from "../availability-refresh-candidates";

describe("buildRefreshCandidates", () => {
  it("filters today/past + offered slots and respects cap ordering", async () => {
    const now = new Date();
    const isoNow = now.toISOString();
    const isoTomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const isoDay2 = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const isoDay3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const deps = {
      getWorkspaceAvailabilitySlotsUtc: async () => ({
        slotsUtc: [isoNow, isoTomorrow, isoDay2, isoDay3],
        availabilitySource: "DEFAULT" as const,
        calendarType: "unknown" as const,
        calendarUrl: "",
        providerMeta: {},
        lastError: null,
      }),
      getWorkspaceSlotOfferCountsForRange: async () =>
        new Map<string, number>([
          [isoTomorrow, 5],
          [isoDay3, 0],
        ]),
      ensureLeadTimezone: async () => ({ timezone: "UTC", source: "existing" as const }),
    };

    const result = await buildRefreshCandidates({
      clientId: "client-1",
      leadId: "lead-1",
      leadOfferedSlotsJson: JSON.stringify([{ datetime: isoDay2 }]),
      snoozedUntil: null,
      availabilitySource: "DEFAULT",
      candidateCap: 2,
      timeZoneOverride: "UTC",
      deps,
    });

    assert.equal(result.candidates.length, 2);

    const labels = Object.entries(result.labelToDatetimeUtcIso);
    const hasNow = labels.some(([, iso]) => iso === isoNow);
    const hasDay2 = labels.some(([, iso]) => iso === isoDay2);
    assert.equal(hasNow, false);
    assert.equal(hasDay2, false);

    const order = result.candidates.map((c) => c.datetimeUtcIso);
    assert.equal(order[0], isoDay3);
    assert.equal(order[1], isoTomorrow);
  });

  it("enforces candidate cap", async () => {
    const now = new Date();
    const isoTomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const isoDay2 = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const deps = {
      getWorkspaceAvailabilitySlotsUtc: async () => ({
        slotsUtc: [isoTomorrow, isoDay2],
        availabilitySource: "DEFAULT" as const,
        calendarType: "unknown" as const,
        calendarUrl: "",
        providerMeta: {},
        lastError: null,
      }),
      getWorkspaceSlotOfferCountsForRange: async () => new Map<string, number>(),
      ensureLeadTimezone: async () => ({ timezone: "UTC", source: "existing" as const }),
    };

    const result = await buildRefreshCandidates({
      clientId: "client-1",
      leadId: "lead-1",
      leadOfferedSlotsJson: null,
      snoozedUntil: null,
      availabilitySource: "DEFAULT",
      candidateCap: 1,
      timeZoneOverride: "UTC",
      deps,
    });

    assert.equal(result.candidates.length, 1);
  });
});

describe("detectPreferredTimezoneToken", () => {
  it("picks the most frequent token", () => {
    const draft = "Available 9:00 AM EST on Tue or 3:00 PM EST on Wed (EST works).";
    assert.equal(detectPreferredTimezoneToken(draft), "EST");
  });
});
