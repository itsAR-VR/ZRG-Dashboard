import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { determineDeterministicBookingTarget } from "../booking-target-selector";

describe("booking-target-selector", () => {
  it("never falls back to with_questions when required answers are missing and no_questions is not configured", () => {
    const res = determineDeterministicBookingTarget({
      requiredCount: 2,
      hasAllRequiredAnswers: false,
      hasWithQuestionsTarget: true,
      hasNoQuestionsTarget: false,
    });

    assert.equal(res.target, "no_questions");
    assert.equal(res.needsNoQuestions, true);
  });

  it("chooses no_questions when required answers are missing and no_questions is configured", () => {
    const res = determineDeterministicBookingTarget({
      requiredCount: 2,
      hasAllRequiredAnswers: false,
      hasWithQuestionsTarget: true,
      hasNoQuestionsTarget: true,
    });

    assert.equal(res.target, "no_questions");
    assert.equal(res.needsNoQuestions, true);
  });

  it("prefers with_questions when no required questions exist and it is configured", () => {
    const res = determineDeterministicBookingTarget({
      requiredCount: 0,
      hasAllRequiredAnswers: false,
      hasWithQuestionsTarget: true,
      hasNoQuestionsTarget: true,
    });

    assert.equal(res.target, "with_questions");
    assert.equal(res.needsNoQuestions, false);
  });

  it("falls back to no_questions when with_questions is not configured and no required answers are needed", () => {
    const res = determineDeterministicBookingTarget({
      requiredCount: 0,
      hasAllRequiredAnswers: false,
      hasWithQuestionsTarget: false,
      hasNoQuestionsTarget: true,
    });

    assert.equal(res.target, "no_questions");
    assert.equal(res.needsNoQuestions, false);
  });
});

