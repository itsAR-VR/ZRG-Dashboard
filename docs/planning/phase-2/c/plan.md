# Phase 2c — Fix: availability refresh noise + missing calendar config ergonomics

## Focus
Prevent “No default calendar link configured” from showing up as repeated errors every cron run, while keeping SSR/availability rendering safe and making it easy to configure the missing setting.

## Inputs
- Phase 2a decisions for “missing calendar link” semantics (error vs unconfigured)
- Relevant code:
  - `lib/availability-cache.ts`:
    - `refreshWorkspaceAvailabilityCache()` (writes cache rows even when unconfigured)
    - `refreshAvailabilityCachesDue()` (selects stale caches repeatedly)
  - Workspace settings/UX surfaces that reference availability/calendar links

## Work
- Adjust cache refresh scheduling to avoid retry-spam when unconfigured:
  - Option A: Treat “no default calendar link” as `skipped` and do not include it in `errors[]`.
  - Option B: Back off refresh for unconfigured workspaces (e.g., set `staleAt` far in the future) and refresh immediately when a default calendar link is added/changed.
  - Option C: Only consider caches “due” when a default calendar link exists.
- Update cron summary output shape to distinguish:
  - `refreshed`, `skippedNoDefault`, `skippedUnsupportedDuration`, `errorsOperational`
- Ensure UI/admin surfaces show an actionable prompt:
  - “Set default calendar link” with a direct navigation path.
  - Optionally: a small “health” indicator if availability is missing/unconfigured.

## Output
- Availability refresh noise reduced and made actionable:
  - `lib/availability-cache.ts` `refreshAvailabilityCachesDue()` now reports:
    - `refreshed`
    - `skippedNoDefault`
    - `skippedUnsupportedDuration`
    - `errors` (operational errors only)
  - “No default calendar link configured” is treated as **skipped** (not an error) and uses a long backoff (`UNCONFIGURED_BACKOFF_MS`) so cron doesn’t re-log it every 10 minutes.
  - Unsupported meeting duration now uses a backoff (`UNSUPPORTED_DURATION_BACKOFF_MS`) and `getWorkspaceAvailabilityCache()` refreshes immediately when meeting duration changes (avoids stale “unsupported” caches persisting until backoff expires).

## Handoff
Proceed to Phase 2d extracting webhook/cron-safe sync logic so automation paths never depend on Supabase user sessions and never call `revalidatePath()` from background jobs.
