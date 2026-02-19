import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyBackgroundPromotionGateDecision,
  computeQueueAgeP95Seconds,
  evaluateBackgroundPromotionGate,
  type BackgroundPromotionGateConfig,
  type BackgroundPromotionGateSignals,
  type BackgroundPromotionGateState,
} from "../background-jobs/promotion-gate";

const BASE_CONFIG: BackgroundPromotionGateConfig = {
  enabled: true,
  requiredWindows: 2,
  windowMs: 30 * 60_000,
  queueAgeP95MaxSeconds: 180,
  failureRatePromotionMaxPercent: 0.5,
  demotionRequiredWindows: 2,
  demotionWindowMs: 15 * 60_000,
  failureRateDemotionMinPercent: 2.0,
  duplicateSendMaxCount: 0,
};

const HEALTHY_SIGNALS: BackgroundPromotionGateSignals = {
  queueAgeP95Seconds: 120,
  failureRatePercent: 0.1,
  contentionBreached: false,
  duplicateSendCount: 0,
};

describe("background job promotion gate", () => {
  it("keeps promotion disabled when feature flag is off", () => {
    const decision = evaluateBackgroundPromotionGate({
      config: { ...BASE_CONFIG, enabled: false },
      state: {
        healthyWindows: 1,
        lastPromotionEvaluatedAtMs: null,
        promoted: false,
        demotionBreachWindows: 0,
        lastDemotionEvaluatedAtMs: null,
        lastObservedFailureRatePercent: 0,
      },
      signals: HEALTHY_SIGNALS,
      now: new Date("2026-02-19T12:00:00.000Z"),
    });

    assert.equal(decision.reasonCode, "feature_disabled");
    assert.equal(decision.promotionGranted, false);
  });

  it("records healthy windows and opens the gate after required windows", () => {
    const state: BackgroundPromotionGateState = {
      healthyWindows: 0,
      lastPromotionEvaluatedAtMs: null,
      promoted: false,
      demotionBreachWindows: 0,
      lastDemotionEvaluatedAtMs: null,
      lastObservedFailureRatePercent: 0,
    };

    const firstNow = new Date("2026-02-19T12:00:00.000Z");
    const first = evaluateBackgroundPromotionGate({
      config: BASE_CONFIG,
      state,
      signals: HEALTHY_SIGNALS,
      now: firstNow,
    });
    applyBackgroundPromotionGateDecision(state, first, firstNow);
    assert.equal(first.reasonCode, "healthy_window_recorded");
    assert.equal(first.promotionGranted, false);
    assert.equal(state.healthyWindows, 1);

    const secondNow = new Date("2026-02-19T12:31:00.000Z");
    const second = evaluateBackgroundPromotionGate({
      config: BASE_CONFIG,
      state,
      signals: HEALTHY_SIGNALS,
      now: secondNow,
    });
    applyBackgroundPromotionGateDecision(state, second, secondNow);
    assert.equal(second.reasonCode, "gate_open");
    assert.equal(second.promotionGranted, true);
    assert.equal(state.healthyWindows, 2);
    assert.equal(state.promoted, true);
  });

  it("resets healthy windows on threshold breach", () => {
    const state: BackgroundPromotionGateState = {
      healthyWindows: 2,
      lastPromotionEvaluatedAtMs: null,
      promoted: false,
      demotionBreachWindows: 0,
      lastDemotionEvaluatedAtMs: null,
      lastObservedFailureRatePercent: 0,
    };

    const decision = evaluateBackgroundPromotionGate({
      config: BASE_CONFIG,
      state,
      signals: {
        ...HEALTHY_SIGNALS,
        failureRatePercent: 1.2,
      },
      now: new Date("2026-02-19T12:00:00.000Z"),
    });
    applyBackgroundPromotionGateDecision(state, decision, new Date("2026-02-19T12:00:00.000Z"));

    assert.equal(decision.reasonCode, "threshold_breach");
    assert.equal(decision.promotionGranted, false);
    assert.equal(state.healthyWindows, 0);
  });

  it("demotes only after sustained demotion breaches when promoted", () => {
    const state: BackgroundPromotionGateState = {
      healthyWindows: 2,
      lastPromotionEvaluatedAtMs: null,
      promoted: true,
      demotionBreachWindows: 0,
      lastDemotionEvaluatedAtMs: null,
      lastObservedFailureRatePercent: 0,
    };

    const firstNow = new Date("2026-02-19T12:00:00.000Z");
    const first = evaluateBackgroundPromotionGate({
      config: BASE_CONFIG,
      state,
      signals: {
        ...HEALTHY_SIGNALS,
        failureRatePercent: 2.4,
      },
      now: firstNow,
    });
    applyBackgroundPromotionGateDecision(state, first, firstNow);
    assert.equal(first.reasonCode, "demotion_breach_recorded");
    assert.equal(first.promotionGranted, true);
    assert.equal(state.promoted, true);

    const secondNow = new Date("2026-02-19T12:16:00.000Z");
    const second = evaluateBackgroundPromotionGate({
      config: BASE_CONFIG,
      state,
      signals: {
        ...HEALTHY_SIGNALS,
        failureRatePercent: 2.2,
      },
      now: secondNow,
    });
    applyBackgroundPromotionGateDecision(state, second, secondNow);
    assert.equal(second.reasonCode, "demotion_gate_closed");
    assert.equal(second.promotionGranted, false);
    assert.equal(state.promoted, false);
  });

  it("demotes immediately on duplicate-send breach", () => {
    const state: BackgroundPromotionGateState = {
      healthyWindows: 2,
      lastPromotionEvaluatedAtMs: null,
      promoted: true,
      demotionBreachWindows: 1,
      lastDemotionEvaluatedAtMs: null,
      lastObservedFailureRatePercent: 0,
    };

    const decision = evaluateBackgroundPromotionGate({
      config: BASE_CONFIG,
      state,
      signals: {
        ...HEALTHY_SIGNALS,
        duplicateSendCount: 1,
      },
      now: new Date("2026-02-19T12:00:00.000Z"),
    });
    applyBackgroundPromotionGateDecision(state, decision, new Date("2026-02-19T12:00:00.000Z"));
    assert.equal(decision.reasonCode, "duplicate_send_immediate_demotion");
    assert.equal(decision.promotionGranted, false);
    assert.equal(state.promoted, false);
  });

  it("computes queue-age p95 from runAt values", () => {
    const now = new Date("2026-02-19T12:00:00.000Z");
    const p95 = computeQueueAgeP95Seconds(
      [
        new Date("2026-02-19T11:59:59.000Z"),
        new Date("2026-02-19T11:59:30.000Z"),
        new Date("2026-02-19T11:55:00.000Z"),
        new Date("2026-02-19T11:50:00.000Z"),
      ],
      now
    );
    assert.equal(p95, 600);
  });
});
