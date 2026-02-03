import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeRefreshedOfferedSlots } from "../offered-slots-refresh";

describe("computeRefreshedOfferedSlots", () => {
  it("updates replaced labels, preserves unchanged labels present, and re-stamps offeredAt", () => {
    const existingOfferedSlotsJson = JSON.stringify([
      {
        datetime: "2026-02-05T15:00:00.000Z",
        label: "9:00 AM EST on Wed, Feb 5",
        offeredAt: "2026-02-01T00:00:00.000Z",
        availabilitySource: "DEFAULT",
      },
      {
        datetime: "2026-02-06T20:00:00.000Z",
        label: "3:00 PM EST on Thu, Feb 6",
        offeredAt: "2026-02-01T00:00:00.000Z",
        availabilitySource: "DEFAULT",
      },
    ]);

    const updatedDraft =
      "Options: 10:00 AM EST on Wed, Feb 5 or 3:00 PM EST on Thu, Feb 6.";

    const offeredAtIso = "2026-02-03T00:00:00.000Z";

    const result = computeRefreshedOfferedSlots({
      existingOfferedSlotsJson,
      updatedDraft,
      replacementsApplied: [{ oldText: "9:00 AM EST on Wed, Feb 5", newText: "10:00 AM EST on Wed, Feb 5" }],
      labelToDatetimeUtcIso: {
        "10:00 AM EST on Wed, Feb 5": "2026-02-05T16:00:00.000Z",
      },
      offeredAtIso,
      availabilitySource: "DEFAULT",
    });

    assert.equal(result.length, 2);
    assert.equal(result[0]?.label, "10:00 AM EST on Wed, Feb 5");
    assert.equal(result[0]?.datetime, "2026-02-05T16:00:00.000Z");
    assert.equal(result[0]?.offeredAt, offeredAtIso);
    assert.equal(result[0]?.availabilitySource, "DEFAULT");

    assert.equal(result[1]?.label, "3:00 PM EST on Thu, Feb 6");
    assert.equal(result[1]?.datetime, "2026-02-06T20:00:00.000Z");
    assert.equal(result[1]?.offeredAt, offeredAtIso);
    assert.equal(result[1]?.availabilitySource, "DEFAULT");
  });

  it("drops slots that are no longer present in the updated draft", () => {
    const existingOfferedSlotsJson = JSON.stringify([
      {
        datetime: "2026-02-05T15:00:00.000Z",
        label: "9:00 AM EST on Wed, Feb 5",
        offeredAt: "2026-02-01T00:00:00.000Z",
        availabilitySource: "DEFAULT",
      },
      {
        datetime: "2026-02-06T20:00:00.000Z",
        label: "3:00 PM EST on Thu, Feb 6",
        offeredAt: "2026-02-01T00:00:00.000Z",
        availabilitySource: "DEFAULT",
      },
    ]);

    const result = computeRefreshedOfferedSlots({
      existingOfferedSlotsJson,
      updatedDraft: "Only one: 3:00 PM EST on Thu, Feb 6.",
      replacementsApplied: [],
      labelToDatetimeUtcIso: {},
      offeredAtIso: "2026-02-03T00:00:00.000Z",
      availabilitySource: "DEFAULT",
    });

    assert.deepEqual(result.map((s) => s.label), ["3:00 PM EST on Thu, Feb 6"]);
  });
});

