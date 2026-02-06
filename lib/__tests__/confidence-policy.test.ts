import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONFIDENCE_POLICY_KEYS,
  coerceConfidencePolicyConfig,
  resolveThresholdFromConfig,
} from "../confidence-policy";

describe("confidence-policy", () => {
  it("coerces configs with a safe default when shape is invalid", () => {
    const cfg = coerceConfidencePolicyConfig(CONFIDENCE_POLICY_KEYS.followupAutoBook, null);
    assert.equal(typeof cfg.thresholds.proposed_times_match_threshold, "number");
    assert.equal(cfg.thresholds.proposed_times_match_threshold, 0.9);
  });

  it("coerces thresholds to finite numbers only", () => {
    const cfg = coerceConfidencePolicyConfig(CONFIDENCE_POLICY_KEYS.followupAutoBook, {
      thresholds: {
        proposed_times_match_threshold: 0.82,
        not_a_number: "0.5",
        nan: Number.NaN,
      },
    });

    assert.equal(cfg.thresholds.proposed_times_match_threshold, 0.82);
    assert.equal("not_a_number" in cfg.thresholds, false);
    assert.equal("nan" in cfg.thresholds, false);
  });

  it("resolves thresholds from config with a default fallback", () => {
    const fromConfig = resolveThresholdFromConfig({
      policyKey: CONFIDENCE_POLICY_KEYS.followupAutoBook,
      field: "proposed_times_match_threshold",
      config: { thresholds: { proposed_times_match_threshold: 0.77 } },
    });
    assert.equal(fromConfig, 0.77);

    const fromDefault = resolveThresholdFromConfig({
      policyKey: CONFIDENCE_POLICY_KEYS.followupAutoBook,
      field: "proposed_times_match_threshold",
      config: { thresholds: {} },
    });
    assert.equal(fromDefault, 0.9);
  });
});

