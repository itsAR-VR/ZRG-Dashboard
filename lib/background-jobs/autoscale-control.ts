const MS_IN_MINUTE = 60_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseFloatBetweenZeroAndOne(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return fallback;
  return parsed;
}

function parseOptionalPositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function clampAtLeastOne(value: number): number {
  return Math.max(1, Math.floor(value));
}

export type BackgroundAutoscaleConfig = {
  globalFloor: number;
  workspaceMultiplier: number;
  rampStep: number;
  rampWindowMs: number;
  stepDownFactor: number;
  operatorOverrideCapacity: number | null;
};

export type BackgroundAutoscaleGuardrailState = {
  contentionBreached: boolean;
  failureRateBreached: boolean;
};

export type BackgroundAutoscaleState = {
  currentCapacity: number;
  lastScaleAtMs: number | null;
};

export type BackgroundAutoscaleDecision = {
  timestamp: string;
  fromCapacity: number;
  toCapacity: number;
  reasonCode:
    | "operator_override"
    | "guardrail_step_down"
    | "ramp_step"
    | "hold_target_reached"
    | "hold_ramp_window";
  guardrailState: BackgroundAutoscaleGuardrailState;
  operatorOverrideActive: boolean;
  correlationId: string;
  globalTarget: number;
};

export function getBackgroundAutoscaleConfig(
  env: NodeJS.ProcessEnv = process.env
): BackgroundAutoscaleConfig {
  return {
    globalFloor: clampAtLeastOne(parsePositiveInt(env.BACKGROUND_JOB_AUTOSCALE_GLOBAL_FLOOR, 1024)),
    workspaceMultiplier: clampAtLeastOne(
      parsePositiveInt(env.BACKGROUND_JOB_AUTOSCALE_WORKSPACE_MULTIPLIER, 64)
    ),
    rampStep: clampAtLeastOne(parsePositiveInt(env.BACKGROUND_JOB_AUTOSCALE_RAMP_STEP, 64)),
    rampWindowMs: clampAtLeastOne(
      parsePositiveInt(env.BACKGROUND_JOB_AUTOSCALE_RAMP_WINDOW_MINUTES, 5) * MS_IN_MINUTE
    ),
    stepDownFactor: parseFloatBetweenZeroAndOne(env.BACKGROUND_JOB_AUTOSCALE_STEP_DOWN_FACTOR, 0.5),
    operatorOverrideCapacity: parseOptionalPositiveInt(env.BACKGROUND_JOB_AUTOSCALE_OVERRIDE_CAPACITY),
  };
}

export function getBackgroundAutoscaleGuardrailState(
  env: NodeJS.ProcessEnv = process.env
): BackgroundAutoscaleGuardrailState {
  return {
    contentionBreached: isTruthy(env.BACKGROUND_JOB_AUTOSCALE_FORCE_CONTENTION_BREACH),
    failureRateBreached: isTruthy(env.BACKGROUND_JOB_AUTOSCALE_FORCE_FAILURE_RATE_BREACH),
  };
}

type EvaluateBackgroundAutoscaleDecisionInput = {
  config: BackgroundAutoscaleConfig;
  guardrailState: BackgroundAutoscaleGuardrailState;
  activeWorkspaceCount: number;
  state: BackgroundAutoscaleState;
  now: Date;
  correlationId: string;
};

export function evaluateBackgroundAutoscaleDecision(
  input: EvaluateBackgroundAutoscaleDecisionInput
): BackgroundAutoscaleDecision {
  const { config, guardrailState, activeWorkspaceCount, state, now, correlationId } = input;
  const effectiveWorkspaceCount = Math.max(0, Math.floor(activeWorkspaceCount));
  const globalTarget = Math.max(config.globalFloor, effectiveWorkspaceCount * config.workspaceMultiplier);
  const fromCapacity = clampAtLeastOne(state.currentCapacity);
  const guardrailBreached = guardrailState.contentionBreached || guardrailState.failureRateBreached;

  let toCapacity = fromCapacity;
  let reasonCode: BackgroundAutoscaleDecision["reasonCode"] = "hold_target_reached";

  if (config.operatorOverrideCapacity) {
    toCapacity = clampAtLeastOne(config.operatorOverrideCapacity);
    reasonCode = "operator_override";
  } else if (guardrailBreached) {
    toCapacity = Math.max(config.globalFloor, Math.floor(fromCapacity * config.stepDownFactor));
    reasonCode = "guardrail_step_down";
  } else if (fromCapacity >= globalTarget) {
    reasonCode = "hold_target_reached";
    toCapacity = fromCapacity;
  } else {
    const nowMs = now.getTime();
    const lastScaleAtMs = state.lastScaleAtMs ?? 0;
    if (nowMs - lastScaleAtMs >= config.rampWindowMs) {
      toCapacity = Math.min(globalTarget, fromCapacity + config.rampStep);
      reasonCode = "ramp_step";
    } else {
      reasonCode = "hold_ramp_window";
      toCapacity = fromCapacity;
    }
  }

  return {
    timestamp: now.toISOString(),
    fromCapacity,
    toCapacity: clampAtLeastOne(toCapacity),
    reasonCode,
    guardrailState,
    operatorOverrideActive: config.operatorOverrideCapacity !== null,
    correlationId,
    globalTarget,
  };
}

export function applyBackgroundAutoscaleDecision(
  state: BackgroundAutoscaleState,
  decision: BackgroundAutoscaleDecision,
  now: Date
): void {
  state.currentCapacity = clampAtLeastOne(decision.toCapacity);
  if (decision.toCapacity !== decision.fromCapacity) {
    state.lastScaleAtMs = now.getTime();
  }
}
