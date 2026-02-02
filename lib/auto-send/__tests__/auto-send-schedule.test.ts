import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getNextAutoSendWindow,
  isWithinAutoSendSchedule,
  resolveAutoSendScheduleConfig,
  type AutoSendScheduleConfig,
} from "../../auto-send-schedule";

function createConfig(overrides: Partial<AutoSendScheduleConfig> = {}): AutoSendScheduleConfig {
  return {
    mode: "ALWAYS",
    timezone: "UTC",
    workStartTime: "09:00",
    workEndTime: "17:00",
    customSchedule: null,
    ...overrides,
  };
}

describe("auto-send schedule helpers", () => {
  it("treats ALWAYS as always within schedule", () => {
    const config = createConfig({ mode: "ALWAYS" });
    const result = isWithinAutoSendSchedule(config, new Date("2026-01-03T12:00:00Z"));
    assert.equal(result.withinSchedule, true);
    assert.equal(result.reason, "always");
  });

  it("checks business hours in the configured timezone", () => {
    const config = createConfig({ mode: "BUSINESS_HOURS" });
    const within = isWithinAutoSendSchedule(config, new Date("2026-01-05T10:00:00Z"));
    assert.equal(within.withinSchedule, true);

    const outside = isWithinAutoSendSchedule(config, new Date("2026-01-05T20:00:00Z"));
    assert.equal(outside.withinSchedule, false);
    assert.equal(outside.reason, "outside_window");
    assert.equal(outside.nextWindowStart?.toISOString(), "2026-01-06T09:00:00.000Z");

    const weekend = isWithinAutoSendSchedule(config, new Date("2026-01-03T10:00:00Z"));
    assert.equal(weekend.withinSchedule, false);
    assert.equal(weekend.reason, "day_not_active");
  });

  it("supports overnight custom schedules", () => {
    const config = createConfig({
      mode: "CUSTOM",
      customSchedule: {
        days: [1],
        startTime: "22:00",
        endTime: "02:00",
        timezone: "UTC",
      },
    });

    const withinLate = isWithinAutoSendSchedule(config, new Date("2026-01-05T23:00:00Z"));
    assert.equal(withinLate.withinSchedule, true);

    const withinEarly = isWithinAutoSendSchedule(config, new Date("2026-01-06T01:00:00Z"));
    assert.equal(withinEarly.withinSchedule, true);

    const outside = isWithinAutoSendSchedule(config, new Date("2026-01-06T03:00:00Z"));
    assert.equal(outside.withinSchedule, false);
    assert.equal(outside.reason, "day_not_active");
  });

  it("blocks preset holidays and moves to the next window", () => {
    const config = createConfig({
      mode: "CUSTOM",
      customSchedule: {
        days: [4], // Thursday
        startTime: "09:00",
        endTime: "17:00",
        timezone: "UTC",
        holidays: { preset: "US_FEDERAL_PLUS_COMMON" },
      },
    });

    const result = isWithinAutoSendSchedule(config, new Date("2026-11-26T10:00:00Z")); // Thanksgiving
    assert.equal(result.withinSchedule, false);
    assert.equal(result.reason, "blackout_date");
    assert.equal(result.nextWindowStart?.toISOString(), "2026-12-03T09:00:00.000Z");
  });

  it("computes the next window start when outside the schedule", () => {
    const config = createConfig({ mode: "BUSINESS_HOURS" });
    const nextWindow = getNextAutoSendWindow(config, new Date("2026-01-05T20:00:00Z"));
    assert.equal(nextWindow.toISOString(), "2026-01-06T09:00:00.000Z");
  });

  it("prefers lead timezone when resolving schedule config", () => {
    const leadPreferred = resolveAutoSendScheduleConfig(
      { timezone: "America/New_York", autoSendScheduleMode: "BUSINESS_HOURS" },
      null,
      "America/Chicago"
    );
    assert.equal(leadPreferred.timezone, "America/Chicago");

    const workspaceFallback = resolveAutoSendScheduleConfig(
      { timezone: "America/New_York", autoSendScheduleMode: "BUSINESS_HOURS" },
      null,
      "Invalid/Zone"
    );
    assert.equal(workspaceFallback.timezone, "America/New_York");
  });
});
