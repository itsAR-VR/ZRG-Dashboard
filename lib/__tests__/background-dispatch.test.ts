import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBackgroundDispatchEventIds,
  computeBackgroundDispatchWindow,
  getBackgroundDispatchWindowSeconds,
} from "../background-jobs/dispatch";

describe("background dispatch window helpers", () => {
  it("rounds requested time into deterministic window keys", () => {
    const requestedAt = new Date("2026-02-17T19:31:45.555Z");
    const window = computeBackgroundDispatchWindow(requestedAt, 60);

    assert.equal(window.windowStart.toISOString(), "2026-02-17T19:31:00.000Z");
    assert.equal(window.windowSeconds, 60);
    assert.equal(window.dispatchKey, "background-jobs:v1:60:2026-02-17T19:31:00.000Z");
  });

  it("builds deterministic and distinct event ids", () => {
    const dispatchKey = "background-jobs:v1:60:2026-02-17T19:31:00.000Z";
    const first = buildBackgroundDispatchEventIds(dispatchKey);
    const second = buildBackgroundDispatchEventIds(dispatchKey);

    assert.deepEqual(first, second);
    assert.notEqual(first.processDispatchId, first.maintenanceDispatchId);
    assert.ok(first.processDispatchId.startsWith("bg-process:"));
    assert.ok(first.maintenanceDispatchId.startsWith("bg-maint:"));
  });

  it("clamps configured dispatch window seconds", () => {
    assert.equal(getBackgroundDispatchWindowSeconds("1"), 15);
    assert.equal(getBackgroundDispatchWindowSeconds("999999"), 3600);
    assert.equal(getBackgroundDispatchWindowSeconds(""), 60);
  });
});
