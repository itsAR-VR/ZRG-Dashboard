import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAiInteractionMetadata } from "../ai/openai-telemetry";

test("AI telemetry metadata: returns undefined for non-objects", () => {
  assert.equal(sanitizeAiInteractionMetadata(null), undefined);
  assert.equal(sanitizeAiInteractionMetadata("nope"), undefined);
  assert.equal(sanitizeAiInteractionMetadata([]), undefined);
});

test("AI telemetry metadata: drops unknown top-level keys", () => {
  assert.deepEqual(
    sanitizeAiInteractionMetadata({
      foo: { bar: 1 },
      leadContextBundle: { profile: "auto_send_evaluator" },
    }),
    { leadContextBundle: { profile: "auto_send_evaluator" } }
  );
});

test("AI telemetry metadata: strips long strings (no raw text)", () => {
  assert.deepEqual(
    sanitizeAiInteractionMetadata({
      leadContextBundle: { ok: "short", raw: "x".repeat(201) },
    }),
    { leadContextBundle: { ok: "short" } }
  );
});

test("AI telemetry metadata: strips non-plain objects and sanitizes arrays", () => {
  assert.deepEqual(
    sanitizeAiInteractionMetadata({
      bookingGate: {
        decision: "approve",
        // Non-plain objects should not persist.
        ts: new Date("2020-01-01T00:00:00.000Z"),
        issues: ["a", "x".repeat(999), 123, null],
      },
    }),
    {
      bookingGate: {
        decision: "approve",
        issues: ["a", 123, null],
      },
    }
  );
});

