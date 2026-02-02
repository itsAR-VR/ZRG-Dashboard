import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeEffectiveSetterSequence, getNextRoundRobinIndex, isChannelEligibleForLeadAssignment } from "../lead-assignment";

describe("getNextRoundRobinIndex", () => {
  it("returns -1 for empty sequences", () => {
    assert.equal(getNextRoundRobinIndex(null, 0), -1);
    assert.equal(getNextRoundRobinIndex(undefined, 0), -1);
    assert.equal(getNextRoundRobinIndex(3, 0), -1);
  });

  it("treats null/undefined as -1 and starts at 0", () => {
    assert.equal(getNextRoundRobinIndex(null, 5), 0);
    assert.equal(getNextRoundRobinIndex(undefined, 5), 0);
  });

  it("wraps around at the end of the sequence", () => {
    assert.equal(getNextRoundRobinIndex(-1, 5), 0);
    assert.equal(getNextRoundRobinIndex(0, 5), 1);
    assert.equal(getNextRoundRobinIndex(4, 5), 0);
  });
});

describe("computeEffectiveSetterSequence", () => {
  it("falls back to active setters when no configured sequence is present", () => {
    assert.deepEqual(
      computeEffectiveSetterSequence({ activeSetterUserIds: ["a", "b"], configuredSequence: null }),
      ["a", "b"]
    );
    assert.deepEqual(
      computeEffectiveSetterSequence({ activeSetterUserIds: ["a", "b"], configuredSequence: [] }),
      ["a", "b"]
    );
  });

  it("filters configured sequence to active setters and preserves duplicates", () => {
    assert.deepEqual(
      computeEffectiveSetterSequence({
        activeSetterUserIds: ["a", "b"],
        configuredSequence: ["a", "b", "a", "b", "c"],
      }),
      ["a", "b", "a", "b"]
    );
  });

  it("returns empty when configured sequence contains no active setters", () => {
    assert.deepEqual(
      computeEffectiveSetterSequence({
        activeSetterUserIds: ["a"],
        configuredSequence: ["b", "b"],
      }),
      []
    );
  });
});

describe("isChannelEligibleForLeadAssignment", () => {
  it("allows all channels when emailOnly=false", () => {
    assert.equal(isChannelEligibleForLeadAssignment({ emailOnly: false, channel: "sms" }), true);
    assert.equal(isChannelEligibleForLeadAssignment({ emailOnly: false, channel: "email" }), true);
    assert.equal(isChannelEligibleForLeadAssignment({ emailOnly: false, channel: "linkedin" }), true);
    assert.equal(isChannelEligibleForLeadAssignment({ emailOnly: false, channel: undefined }), true);
  });

  it("allows only email channel when emailOnly=true", () => {
    assert.equal(isChannelEligibleForLeadAssignment({ emailOnly: true, channel: "email" }), true);
    assert.equal(isChannelEligibleForLeadAssignment({ emailOnly: true, channel: "sms" }), false);
    assert.equal(isChannelEligibleForLeadAssignment({ emailOnly: true, channel: "linkedin" }), false);
    assert.equal(isChannelEligibleForLeadAssignment({ emailOnly: true, channel: undefined }), false);
  });
});

