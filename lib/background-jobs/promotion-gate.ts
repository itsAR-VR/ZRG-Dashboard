function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseNonNegativeFloat(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value || "");
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export type BackgroundPromotionGateConfig = {
  enabled: boolean;
  requiredWindows: number;
  windowMs: number;
  queueAgeP95MaxSeconds: number;
  failureRatePromotionMaxPercent: number;
  demotionRequiredWindows: number;
  demotionWindowMs: number;
  failureRateDemotionMinPercent: number;
  duplicateSendMaxCount: number;
};

export type BackgroundPromotionGateState = {
  healthyWindows: number;
  lastPromotionEvaluatedAtMs: number | null;
  promoted: boolean;
  demotionBreachWindows: number;
  lastDemotionEvaluatedAtMs: number | null;
  lastObservedFailureRatePercent: number;
};

export type BackgroundPromotionGateSignals = {
  queueAgeP95Seconds: number;
  failureRatePercent: number;
  contentionBreached: boolean;
  duplicateSendCount: number;
};

export type BackgroundPromotionGateDecision = {
  timestamp: string;
  promotionGranted: boolean;
  reasonCode:
    | "feature_disabled"
    | "duplicate_send_immediate_demotion"
    | "healthy_window_recorded"
    | "healthy_window_waiting_interval"
    | "threshold_breach"
    | "gate_open"
    | "demotion_breach_recorded"
    | "demotion_waiting_interval"
    | "demotion_gate_closed";
  healthyWindows: number;
  demotionBreachWindows: number;
  requiredWindows: number;
  signals: BackgroundPromotionGateSignals;
  nextState: BackgroundPromotionGateState;
};

export function getBackgroundPromotionGateConfig(
  env: NodeJS.ProcessEnv = process.env
): BackgroundPromotionGateConfig {
  return {
    enabled: isTruthy(env.BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_ENABLED),
    requiredWindows: Math.max(1, parsePositiveInt(env.BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_REQUIRED_WINDOWS, 4)),
    windowMs: Math.max(
      60_000,
      parsePositiveInt(env.BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_WINDOW_MINUTES, 30) * 60_000
    ),
    queueAgeP95MaxSeconds: Math.max(
      1,
      parsePositiveInt(env.BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_QUEUE_AGE_P95_MAX_SECONDS, 180)
    ),
    failureRatePromotionMaxPercent: parseNonNegativeFloat(
      env.BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_FAILURE_RATE_MAX_PERCENT,
      0.5
    ),
    demotionRequiredWindows: Math.max(
      1,
      parsePositiveInt(env.BACKGROUND_JOB_HIGH_QUOTA_DEMOTION_REQUIRED_WINDOWS, 2)
    ),
    demotionWindowMs: Math.max(
      60_000,
      parsePositiveInt(env.BACKGROUND_JOB_HIGH_QUOTA_DEMOTION_WINDOW_MINUTES, 15) * 60_000
    ),
    failureRateDemotionMinPercent: parseNonNegativeFloat(
      env.BACKGROUND_JOB_HIGH_QUOTA_DEMOTION_FAILURE_RATE_MIN_PERCENT,
      2.0
    ),
    duplicateSendMaxCount: parseNonNegativeInt(
      env.BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_DUPLICATE_SEND_MAX_COUNT,
      0
    ),
  };
}

export function getBackgroundObservedDuplicateSendCount(
  env: NodeJS.ProcessEnv = process.env
): number {
  return parseNonNegativeInt(env.BACKGROUND_JOB_OBS_DUPLICATE_SEND_COUNT, 0);
}

export function computeQueueAgeP95Seconds(
  runAtValues: Date[],
  now: Date
): number {
  if (runAtValues.length === 0) return 0;
  const nowMs = now.getTime();
  const agesMs = runAtValues
    .map((runAt) => Math.max(0, nowMs - runAt.getTime()))
    .sort((a, b) => a - b);
  const percentileIndex = Math.min(
    agesMs.length - 1,
    Math.max(0, Math.ceil(agesMs.length * 0.95) - 1)
  );
  return Math.floor(agesMs[percentileIndex] / 1000);
}

type EvaluateBackgroundPromotionGateInput = {
  config: BackgroundPromotionGateConfig;
  state: BackgroundPromotionGateState;
  signals: BackgroundPromotionGateSignals;
  now: Date;
};

export function evaluateBackgroundPromotionGate(
  input: EvaluateBackgroundPromotionGateInput
): BackgroundPromotionGateDecision {
  const { config, state, signals, now } = input;
  const timestamp = now.toISOString();
  const nowMs = now.getTime();
  const nextState: BackgroundPromotionGateState = {
    healthyWindows: state.healthyWindows,
    lastPromotionEvaluatedAtMs: state.lastPromotionEvaluatedAtMs,
    promoted: state.promoted,
    demotionBreachWindows: state.demotionBreachWindows,
    lastDemotionEvaluatedAtMs: state.lastDemotionEvaluatedAtMs,
    lastObservedFailureRatePercent: state.lastObservedFailureRatePercent,
  };

  if (!config.enabled) {
    nextState.promoted = false;
    return {
      timestamp,
      promotionGranted: false,
      reasonCode: "feature_disabled",
      healthyWindows: nextState.healthyWindows,
      demotionBreachWindows: nextState.demotionBreachWindows,
      requiredWindows: config.requiredWindows,
      signals,
      nextState,
    };
  }

  if (signals.duplicateSendCount > config.duplicateSendMaxCount) {
    nextState.promoted = false;
    nextState.healthyWindows = 0;
    nextState.demotionBreachWindows = 0;
    nextState.lastDemotionEvaluatedAtMs = nowMs;
    return {
      timestamp,
      promotionGranted: false,
      reasonCode: "duplicate_send_immediate_demotion",
      healthyWindows: nextState.healthyWindows,
      demotionBreachWindows: nextState.demotionBreachWindows,
      requiredWindows: config.requiredWindows,
      signals,
      nextState,
    };
  }

  if (state.promoted) {
    const demotionBreached =
      signals.contentionBreached || signals.failureRatePercent >= config.failureRateDemotionMinPercent;

    if (!demotionBreached) {
      nextState.demotionBreachWindows = 0;
      nextState.lastDemotionEvaluatedAtMs = nowMs;
      nextState.promoted = true;
      return {
        timestamp,
        promotionGranted: true,
        reasonCode: "gate_open",
        healthyWindows: nextState.healthyWindows,
        demotionBreachWindows: nextState.demotionBreachWindows,
        requiredWindows: config.requiredWindows,
        signals,
        nextState,
      };
    }

    const lastDemotionEvaluatedAtMs = state.lastDemotionEvaluatedAtMs ?? 0;
    if (nowMs - lastDemotionEvaluatedAtMs < config.demotionWindowMs) {
      return {
        timestamp,
        promotionGranted: true,
        reasonCode: "demotion_waiting_interval",
        healthyWindows: nextState.healthyWindows,
        demotionBreachWindows: nextState.demotionBreachWindows,
        requiredWindows: config.requiredWindows,
        signals,
        nextState,
      };
    }

    nextState.lastDemotionEvaluatedAtMs = nowMs;
    nextState.demotionBreachWindows = Math.min(
      config.demotionRequiredWindows,
      state.demotionBreachWindows + 1
    );
    if (nextState.demotionBreachWindows >= config.demotionRequiredWindows) {
      nextState.promoted = false;
      nextState.healthyWindows = 0;
      nextState.demotionBreachWindows = 0;
      return {
        timestamp,
        promotionGranted: false,
        reasonCode: "demotion_gate_closed",
        healthyWindows: nextState.healthyWindows,
        demotionBreachWindows: nextState.demotionBreachWindows,
        requiredWindows: config.requiredWindows,
        signals,
        nextState,
      };
    }

    return {
      timestamp,
      promotionGranted: true,
      reasonCode: "demotion_breach_recorded",
      healthyWindows: nextState.healthyWindows,
      demotionBreachWindows: nextState.demotionBreachWindows,
      requiredWindows: config.requiredWindows,
      signals,
      nextState,
    };
  }

  const thresholdBreached =
    signals.contentionBreached ||
    signals.queueAgeP95Seconds >= config.queueAgeP95MaxSeconds ||
    signals.failureRatePercent >= config.failureRatePromotionMaxPercent;

  if (thresholdBreached) {
    nextState.promoted = false;
    nextState.healthyWindows = 0;
    nextState.lastPromotionEvaluatedAtMs = nowMs;
    return {
      timestamp,
      promotionGranted: false,
      reasonCode: "threshold_breach",
      healthyWindows: nextState.healthyWindows,
      demotionBreachWindows: nextState.demotionBreachWindows,
      requiredWindows: config.requiredWindows,
      signals,
      nextState,
    };
  }

  const lastPromotionEvaluatedAtMs = state.lastPromotionEvaluatedAtMs ?? 0;
  if (nowMs - lastPromotionEvaluatedAtMs < config.windowMs) {
    return {
      timestamp,
      promotionGranted: false,
      reasonCode: "healthy_window_waiting_interval",
      healthyWindows: nextState.healthyWindows,
      demotionBreachWindows: nextState.demotionBreachWindows,
      requiredWindows: config.requiredWindows,
      signals,
      nextState,
    };
  }

  nextState.lastPromotionEvaluatedAtMs = nowMs;
  const nextHealthyWindows = Math.min(config.requiredWindows, state.healthyWindows + 1);
  const promotionGranted = nextHealthyWindows >= config.requiredWindows;
  nextState.healthyWindows = nextHealthyWindows;
  nextState.promoted = promotionGranted;
  if (promotionGranted) {
    nextState.demotionBreachWindows = 0;
    nextState.lastDemotionEvaluatedAtMs = null;
  }

  return {
    timestamp,
    promotionGranted,
    reasonCode: promotionGranted ? "gate_open" : "healthy_window_recorded",
    healthyWindows: nextHealthyWindows,
    demotionBreachWindows: nextState.demotionBreachWindows,
    requiredWindows: config.requiredWindows,
    signals,
    nextState,
  };
}

export function applyBackgroundPromotionGateDecision(
  state: BackgroundPromotionGateState,
  decision: BackgroundPromotionGateDecision,
  _now: Date
): void {
  Object.assign(state, decision.nextState);
}
