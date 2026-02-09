import assert from "node:assert/strict";
import test from "node:test";

import { evaluateStep3RewriteGuardrail } from "../step3-guardrail";

test("evaluateStep3RewriteGuardrail flags large length rewrites", () => {
  const before = "A".repeat(800);
  const after = "A".repeat(200);
  const result = evaluateStep3RewriteGuardrail(before, after);
  assert.equal(result.isRewrite, true);
});

test("evaluateStep3RewriteGuardrail allows small localized edits", () => {
  const before = "Hi John,\n\nThanks for the note.\n\nBest,\nAlex";
  const after = "Hi John,\n\nThanks for the note.\n\nBest,\nAlex.";
  const result = evaluateStep3RewriteGuardrail(before, after);
  assert.equal(result.isRewrite, false);
});

test("evaluateStep3RewriteGuardrail flags large line count changes", () => {
  const before = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6";
  const after = "Line 1\nLine 2";
  const result = evaluateStep3RewriteGuardrail(before, after);
  assert.equal(result.isRewrite, true);
});

test("evaluateStep3RewriteGuardrail does not flag at exact length ratio threshold", () => {
  const before = "A".repeat(1000);
  const after = "A".repeat(1450); // delta=450, ratio=0.45
  const result = evaluateStep3RewriteGuardrail(before, after);
  assert.equal(result.isRewrite, false);
});

test("evaluateStep3RewriteGuardrail does not flag when ratio is high but delta is below minDelta", () => {
  const before = "A".repeat(400);
  const after = "A".repeat(590); // delta=190, ratio=0.475
  const result = evaluateStep3RewriteGuardrail(before, after);
  assert.equal(result.isRewrite, false);
});

test("evaluateStep3RewriteGuardrail does not flag at exact line ratio threshold", () => {
  const before = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6";
  const after = "Line 1\nLine 2\nLine 3"; // lineDelta=3, lineRatio=0.5
  const result = evaluateStep3RewriteGuardrail(before, after);
  assert.equal(result.isRewrite, false);
});

test("evaluateStep3RewriteGuardrail does not flag identical drafts", () => {
  const before = "Hi John,\n\nThanks for the note.\n\nBest,\nAlex";
  const after = before;
  const result = evaluateStep3RewriteGuardrail(before, after);
  assert.equal(result.isRewrite, false);
});
