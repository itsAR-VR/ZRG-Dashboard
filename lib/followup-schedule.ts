const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Normalize FollowUpStep.dayOffset to a day-count offset in milliseconds.
 *
 * Semantics:
 * - `dayOffset=1` means Day 1 (0 days after start)
 * - `dayOffset=2` means Day 2 (+1 day)
 * - Backward compatible with `dayOffset=0` meaning immediate (0 days)
 */
export function normalizeDayOffsetToDays(dayOffset: number | null | undefined): number {
  const value = typeof dayOffset === "number" ? dayOffset : 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value) - 1);
}

export function computeStepOffsetMs(step: { dayOffset: number; minuteOffset?: number | null }): number {
  return normalizeDayOffsetToDays(step.dayOffset) * DAY_MS + (step.minuteOffset ?? 0) * MINUTE_MS;
}

export function computeStepDeltaMs(
  currentStep: { dayOffset: number; minuteOffset?: number | null },
  nextStep: { dayOffset: number; minuteOffset?: number | null }
): number {
  const delta = computeStepOffsetMs(nextStep) - computeStepOffsetMs(currentStep);
  if (delta < 0) {
    console.warn("[followup-schedule] Negative step delta detected; clamping to 0", {
      currentStep,
      nextStep,
      delta,
    });
  }
  return Math.max(0, delta);
}
