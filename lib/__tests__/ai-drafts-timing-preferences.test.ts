import assert from "node:assert/strict";
import test from "node:test";

import { extractTimingPreferencesFromText } from "../ai-drafts";

test("extractTimingPreferencesFromText parses weekday + explicit time window", () => {
  const parsed = extractTimingPreferencesFromText("I can do Friday between 12PM and 3PM PST.", "America/Los_Angeles");
  assert.ok(parsed);
  assert.deepEqual(parsed?.weekdayTokens, ["fri"]);
  assert.deepEqual(parsed?.timeWindow, { startMinutes: 12 * 60, endMinutes: 15 * 60 });
});

test("extractTimingPreferencesFromText parses compact shared-meridiem range", () => {
  const parsed = extractTimingPreferencesFromText("Tuesday works, maybe 9-11am.", "America/New_York");
  assert.ok(parsed);
  assert.deepEqual(parsed?.weekdayTokens, ["tue"]);
  assert.deepEqual(parsed?.timeWindow, { startMinutes: 9 * 60, endMinutes: 11 * 60 });
});

test("extractTimingPreferencesFromText returns null for messages with no timing cues", () => {
  const parsed = extractTimingPreferencesFromText("Thanks for the note, send more details.", "America/New_York");
  assert.equal(parsed, null);
});
