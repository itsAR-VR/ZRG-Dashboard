import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyBackgroundAutoscaleDecision,
  evaluateBackgroundAutoscaleDecision,
  type BackgroundAutoscaleConfig,
  type BackgroundAutoscaleGuardrailState,
  type BackgroundAutoscaleState,
} from "../background-jobs/autoscale-control";

const BASE_CONFIG: BackgroundAutoscaleConfig = {
  globalFloor: 1024,
  workspaceMultiplier: 64,
  rampStep: 64,
  rampWindowMs: 5 * 60_000,
  stepDownFactor: 0.5,
  operatorOverrideCapacity: null,
};

const HEALTHY_GUARDRAILS: BackgroundAutoscaleGuardrailState = {
  contentionBreached: false,
  failureRateBreached: false,
};

describe("background job autoscale control", () => {
  it("ramps by one step after ramp window when target is above current", () => {
    const now = new Date("2026-02-19T12:00:00.000Z");
    const state: BackgroundAutoscaleState = {
      currentCapacity: 1024,
      lastScaleAtMs: now.getTime() - 6 * 60_000,
    };

    const decision = evaluateBackgroundAutoscaleDecision({
      config: BASE_CONFIG,
      guardrailState: HEALTHY_GUARDRAILS,
      activeWorkspaceCount: 17, // target 1088
      state,
      now,
      correlationId: "corr-1",
    });

    assert.equal(decision.reasonCode, "ramp_step");
    assert.equal(decision.fromCapacity, 1024);
    assert.equal(decision.toCapacity, 1088);
    assert.equal(decision.globalTarget, 1088);
  });

  it("holds during ramp window before next step is allowed", () => {
    const now = new Date("2026-02-19T12:00:00.000Z");
    const state: BackgroundAutoscaleState = {
      currentCapacity: 1024,
      lastScaleAtMs: now.getTime() - 2 * 60_000,
    };

    const decision = evaluateBackgroundAutoscaleDecision({
      config: BASE_CONFIG,
      guardrailState: HEALTHY_GUARDRAILS,
      activeWorkspaceCount: 20, // target 1280
      state,
      now,
      correlationId: "corr-2",
    });

    assert.equal(decision.reasonCode, "hold_ramp_window");
    assert.equal(decision.toCapacity, 1024);
  });

  it("steps down deterministically on guardrail breach and respects floor", () => {
    const now = new Date("2026-02-19T12:00:00.000Z");
    const state: BackgroundAutoscaleState = {
      currentCapacity: 1408,
      lastScaleAtMs: now.getTime() - 10 * 60_000,
    };

    const decision = evaluateBackgroundAutoscaleDecision({
      config: BASE_CONFIG,
      guardrailState: { contentionBreached: true, failureRateBreached: false },
      activeWorkspaceCount: 30,
      state,
      now,
      correlationId: "corr-3",
    });

    assert.equal(decision.reasonCode, "guardrail_step_down");
    assert.equal(decision.toCapacity, 1024);
  });

  it("honors operator override over guardrails and ramp logic", () => {
    const now = new Date("2026-02-19T12:00:00.000Z");
    const state: BackgroundAutoscaleState = {
      currentCapacity: 1024,
      lastScaleAtMs: now.getTime() - 10 * 60_000,
    };

    const decision = evaluateBackgroundAutoscaleDecision({
      config: {
        ...BASE_CONFIG,
        operatorOverrideCapacity: 222,
      },
      guardrailState: { contentionBreached: true, failureRateBreached: true },
      activeWorkspaceCount: 50,
      state,
      now,
      correlationId: "corr-4",
    });

    assert.equal(decision.reasonCode, "operator_override");
    assert.equal(decision.toCapacity, 222);
    assert.equal(decision.operatorOverrideActive, true);
  });

  it("updates autoscale state after a decision is applied", () => {
    const now = new Date("2026-02-19T12:00:00.000Z");
    const state: BackgroundAutoscaleState = {
      currentCapacity: 1024,
      lastScaleAtMs: null,
    };

    const decision = evaluateBackgroundAutoscaleDecision({
      config: BASE_CONFIG,
      guardrailState: HEALTHY_GUARDRAILS,
      activeWorkspaceCount: 17,
      state,
      now,
      correlationId: "corr-5",
    });

    applyBackgroundAutoscaleDecision(state, decision, now);
    assert.equal(state.currentCapacity, decision.toCapacity);
    assert.equal(state.lastScaleAtMs, now.getTime());
  });
});
