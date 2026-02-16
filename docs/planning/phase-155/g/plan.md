# Phase 155g — Inngest Cutover Hardening (Cron Parity + Env Hygiene + Safe Rollout)

## Focus
Make the Inngest cutover safe and production-parity so enabling `BACKGROUND_JOBS_USE_INNGEST=true` does not drop required cron maintenance work, does not allow Preview to mutate Production, and has explicit rollback levers.

## Inputs
- Current cron route: `app/api/cron/background-jobs/route.ts`
  - Contains additional maintenance work beyond `processBackgroundJobs()`:
    - queue health/staleness reporting
    - stale draft recovery
    - pruning draft pipeline runs + inferred memory entries
- Inngest route + function:
  - `app/api/inngest/route.ts`
  - `lib/inngest/functions/process-background-jobs.ts`
- Background job runner: `lib/background-jobs/runner.ts`
- Redis helpers: `lib/redis.ts`
- Env vars:
  - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
  - `INNGEST_ENV`
  - `BACKGROUND_JOBS_USE_INNGEST`

## Work
1. **Define cutover parity contract (decision-complete)**
   - Cron becomes enqueue-only for background work, but must still run the same responsibilities via Inngest.
   - Use two durable functions:
     - `background/process.requested` → queue draining (`processBackgroundJobs()`)
     - `background/maintenance.requested` → cron maintenance parity:
       - stale draft recovery
       - pruning draft pipeline runs
       - pruning inferred lead/workspace memory
       - queue health/stale detection logs/metrics

2. **Fix env hygiene (Preview isolation)**
   - Vercel **Production**: set `INNGEST_ENV=production`.
   - Vercel **Preview**: do not set `INNGEST_ENV=production`.
     - Default: omit `INNGEST_ENV` (SDK auto-uses `VERCEL_GIT_COMMIT_REF`).
     - Allowed alternative: set `INNGEST_ENV=$VERCEL_GIT_COMMIT_REF`.
   - Add an explicit verification step:
     - `curl -I https://<preview-url>/api/inngest | rg -i x-inngest-env`
     - must not equal `production`.

3. **Implement cron enqueue fallback (decision-complete)**
   - If `inngest.send()` fails:
     - log structured error
     - run inline processing for that tick as the fallback
   - Goal: avoid any “dead zone” where neither enqueue nor inline runs.

4. **Implement maintenance parity in Inngest**
   - Ensure parity for:
     - stale draft recovery
     - pruning draft pipeline runs
     - pruning inferred lead/workspace memory
     - queue health/stale detection (emit log/metric, not UI-only)
   - Prefer returning a compact JSON summary for run visibility.

5. **Add minimal job status keys (Redis)**
   - Write a status blob for each durable job:
     - `job:v1:{clientId}:{jobName}`
   - Include:
     - `status`, `startedAt`, `finishedAt`, `durationMs`, `attempt`, `lastError`
   - Job names:
     - `process-background-jobs`
     - `background-maintenance`

6. **Rollout / rollback checklist**
   - Canary enablement:
     - turn on `BACKGROUND_JOBS_USE_INNGEST=true` for Production
     - confirm cron returns `202` and Inngest runs execute within budget
   - Rollback:
     - flip `BACKGROUND_JOBS_USE_INNGEST=false`
     - confirm maintenance work resumes inline immediately

## Validation (RED TEAM)
- Functional:
  - Trigger cron route with `BACKGROUND_JOBS_USE_INNGEST=true` and confirm:
    - Inngest run executes `processBackgroundJobs()` (process function)
    - Inngest run executes maintenance parity work (maintenance function)
  - Force enqueue failure (bad event key in preview env) and confirm fallback behaves as intended.
- Safety:
  - Preview isolation check: preview `/api/inngest` must not report `x-inngest-env: production`.
  - Verify no production sync URL points at a preview deployment.
- Performance:
  - Confirm Inngest runs complete within Vercel max duration and the runner time budget.

## Output
- A safe, parity-preserving path to make cron enqueue-only for background processing.
- Explicit, testable guardrails preventing Preview from mutating Production Inngest state.

## Handoff
After Phase 155g, it is safe to enable `BACKGROUND_JOBS_USE_INNGEST=true` broadly and proceed with remaining Phase 155 items (counts/analytics recompute events + realtime hardening + observability).
