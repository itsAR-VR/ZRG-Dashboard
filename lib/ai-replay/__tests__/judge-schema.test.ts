import assert from "node:assert/strict";
import test from "node:test";

import { validateReplayJudgeScore } from "@/lib/ai-replay/judge-schema";

test("validateReplayJudgeScore accepts valid payload", () => {
  const payload = {
    pass: true,
    confidence: 0.93,
    overallScore: 91,
    dimensions: {
      pricingCadenceAccuracy: 90,
      factualAlignment: 92,
      safetyAndPolicy: 95,
      responseQuality: 88,
    },
    failureReasons: [],
    suggestedFixes: ["Keep quarterly billing wording explicit."],
    summary: "Draft is accurate and safe.",
  };

  const result = validateReplayJudgeScore(payload);
  assert.equal(result.pass, true);
  assert.equal(result.overallScore, 91);
  assert.equal(result.dimensions.pricingCadenceAccuracy, 90);
});

test("validateReplayJudgeScore rejects invalid confidence", () => {
  assert.throws(
    () =>
      validateReplayJudgeScore({
        pass: false,
        confidence: 1.3,
        overallScore: 20,
        dimensions: {
          pricingCadenceAccuracy: 10,
          factualAlignment: 20,
          safetyAndPolicy: 30,
          responseQuality: 20,
        },
        failureReasons: ["Mismatch"],
        suggestedFixes: ["Fix cadence"],
        summary: "Bad",
      }),
    /confidence must be a number between 0 and 1/
  );
});
