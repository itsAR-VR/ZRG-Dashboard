import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { interpretAutoSendEvaluatorOutput } from "../../auto-send-evaluator";

describe("interpretAutoSendEvaluatorOutput", () => {
  it("treats contradictory JSON (safe_to_send=true, requires_human_review=true) as unsafe", () => {
    const result = interpretAutoSendEvaluatorOutput({
      safe_to_send: true,
      requires_human_review: true,
      confidence: 0.95,
      reason: "test",
    });

    assert.equal(result.safeToSend, false);
    assert.equal(result.requiresHumanReview, true);
    assert.equal(result.confidence, 0.95);
  });

  it("treats safe_to_send=true and requires_human_review=false as safe (when confidence is valid)", () => {
    const result = interpretAutoSendEvaluatorOutput({
      safe_to_send: true,
      requires_human_review: false,
      confidence: 0.95,
      reason: "ok",
    });

    assert.equal(result.safeToSend, true);
    assert.equal(result.requiresHumanReview, false);
  });

  it("clamps confidence to [0, 1] and requires minimum confidence for safe sends", () => {
    const low = interpretAutoSendEvaluatorOutput({
      safe_to_send: true,
      requires_human_review: false,
      confidence: -1,
      reason: "low",
    });
    assert.equal(low.confidence, 0);
    assert.equal(low.safeToSend, false);
    assert.equal(low.requiresHumanReview, true);

    const high = interpretAutoSendEvaluatorOutput({
      safe_to_send: true,
      requires_human_review: false,
      confidence: 2,
      reason: "high",
    });
    assert.equal(high.confidence, 1);
    assert.equal(high.safeToSend, true);
    assert.equal(high.requiresHumanReview, false);
  });
});

