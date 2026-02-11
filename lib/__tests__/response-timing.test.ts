import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeChosenDelaySeconds } from "../background-jobs/delayed-auto-send";

describe("computeChosenDelaySeconds", () => {
  it("returns a deterministic delay within the requested range", () => {
    const first = computeChosenDelaySeconds("msg-1", 180, 420);
    const second = computeChosenDelaySeconds("msg-1", 180, 420);

    assert.equal(first, second);
    assert.ok(first >= 180 && first <= 420);
  });

  it("handles equal min/max windows", () => {
    assert.equal(computeChosenDelaySeconds("msg-1", 300, 300), 300);
    assert.equal(computeChosenDelaySeconds("msg-2", 0, 0), 0);
  });

  it("treats max<min as an empty range and returns min", () => {
    assert.equal(computeChosenDelaySeconds("msg-1", 7, 3), 7);
  });
});

