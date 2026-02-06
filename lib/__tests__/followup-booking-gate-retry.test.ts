import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runFollowupBookingGateWithOneRetry } from "../followup-engine";

type GateDecision = {
  decision: "approve" | "needs_clarification" | "deny";
  confidence: number;
  issues: string[];
  clarificationMessage: string | null;
  rationale: string;
};

describe("runFollowupBookingGateWithOneRetry", () => {
  it("does not retry when the first attempt approves", async () => {
    const calls: Array<0 | 1> = [];
    const approve: GateDecision = {
      decision: "approve",
      confidence: 0.9,
      issues: [],
      clarificationMessage: null,
      rationale: "ok",
    };

    const result = await runFollowupBookingGateWithOneRetry({
      runAttempt: async (retryCount) => {
        calls.push(retryCount);
        return approve;
      },
    });

    assert.deepEqual(calls, [0]);
    assert.equal(result.attempts, 1);
    assert.equal(result.gate?.decision, "approve");
  });

  it("retries exactly once when the first attempt needs clarification", async () => {
    const calls: Array<0 | 1> = [];
    const needsClarification: GateDecision = {
      decision: "needs_clarification",
      confidence: 0.6,
      issues: ["timezone_unknown"],
      clarificationMessage: "What timezone are you in?",
      rationale: "missing tz",
    };
    const approve: GateDecision = {
      decision: "approve",
      confidence: 0.85,
      issues: [],
      clarificationMessage: null,
      rationale: "ok",
    };

    const result = await runFollowupBookingGateWithOneRetry({
      runAttempt: async (retryCount) => {
        calls.push(retryCount);
        return retryCount === 0 ? needsClarification : approve;
      },
    });

    assert.deepEqual(calls, [0, 1]);
    assert.equal(result.attempts, 2);
    assert.equal(result.gate?.decision, "approve");
  });

  it("does not retry when the first attempt denies", async () => {
    const calls: Array<0 | 1> = [];
    const deny: GateDecision = {
      decision: "deny",
      confidence: 0.8,
      issues: ["not_scheduling_related"],
      clarificationMessage: null,
      rationale: "not scheduling",
    };

    const result = await runFollowupBookingGateWithOneRetry({
      runAttempt: async (retryCount) => {
        calls.push(retryCount);
        return deny;
      },
    });

    assert.deepEqual(calls, [0]);
    assert.equal(result.attempts, 1);
    assert.equal(result.gate?.decision, "deny");
  });

  it("returns null without retry when the first attempt fails", async () => {
    const calls: Array<0 | 1> = [];

    const result = await runFollowupBookingGateWithOneRetry({
      runAttempt: async (retryCount) => {
        calls.push(retryCount);
        return null;
      },
    });

    assert.deepEqual(calls, [0]);
    assert.equal(result.attempts, 1);
    assert.equal(result.gate, null);
  });

  it("returns null when the retry attempt fails", async () => {
    const calls: Array<0 | 1> = [];
    const needsClarification: GateDecision = {
      decision: "needs_clarification",
      confidence: 0.6,
      issues: ["ambiguous"],
      clarificationMessage: "Can you clarify?",
      rationale: "ambiguous",
    };

    const result = await runFollowupBookingGateWithOneRetry({
      runAttempt: async (retryCount) => {
        calls.push(retryCount);
        return retryCount === 0 ? needsClarification : null;
      },
    });

    assert.deepEqual(calls, [0, 1]);
    assert.equal(result.attempts, 2);
    assert.equal(result.gate, null);
  });
});

