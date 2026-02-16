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

## Output (2026-02-16)
- Implemented cron/Inngest parity cutover wiring:
  - Added shared maintenance module and delegated cron inline maintenance to it:
    - `lib/background-jobs/maintenance.ts`
    - `app/api/cron/background-jobs/route.ts`
  - Added second durable event + function for maintenance parity:
    - `background/maintenance.requested`
    - `lib/inngest/functions/background-maintenance.ts`
    - `lib/inngest/functions/index.ts`
    - `lib/inngest/events.ts`
- Added enqueue-failure fallback in cron:
  - If `inngest.send()` fails while `BACKGROUND_JOBS_USE_INNGEST=true`, route now runs inline processing+maintenance in the same tick (`mode: "inline-fallback"`), avoiding dead-zone drops.
- Added minimal Redis job status blobs for durable jobs:
  - `lib/inngest/job-status.ts`
  - Keys: `job:v1:{scope}:{jobName}` with fields:
    - `status`, `startedAt`, `finishedAt`, `durationMs`, `attempt`, `lastError`, `source`, `updatedAt`
  - Writers added to:
    - `lib/inngest/functions/process-background-jobs.ts`
    - `lib/inngest/functions/background-maintenance.ts`
- Updated brittle tests to reflect new architecture split:
  - `lib/__tests__/draft-pipeline-retention-cron.test.ts`
  - `lib/__tests__/stale-sending-recovery.test.ts`

## Validation Evidence
- `npm run lint` ✅ (warnings only; pre-existing hook/compiler warnings in dashboard files)
- `npm run build` ✅
- `npm run typecheck` ✅
- `npm test` ✅ (384 pass, 0 fail)

### NTTAN Gate (required for cron/AI-adjacent changes)
- `npm run test:ai-drafts` ✅ (68 pass, 0 fail)
- No `docs/planning/phase-155/replay-case-manifest.json` existed, so fallback replay commands were used with workspace client ID from active production logs:
  - `npm run test:ai-replay -- --client-id 731255d1-2ca5-4b37-ad34-aeb5b801be3b --limit 20 --dry-run` ✅
  - `npm run test:ai-replay -- --client-id 731255d1-2ca5-4b37-ad34-aeb5b801be3b --limit 20 --concurrency 3` ✅
- Replay artifact:
  - `.artifacts/ai-replay/run-2026-02-16T10-59-17-959Z.json`
- Replay judge metadata (from artifact `cases[].judge`):
  - `promptKey`: `meeting.overseer.gate.v1`
  - `systemPrompt`: present on evaluated cases (9)
- Failure type counts:
  - `draft_quality_error=1`, all others `0`
- Critical invariants:
  - `slot_mismatch=0`, `date_mismatch=0`, `fabricated_link=0`, `empty_draft=0`, `non_logistics_reply=0`

## Multi-Agent Coordination (last 10 phases scan)
- Scanned overlap across `docs/planning/phase-156` to `docs/planning/phase-147`.
- Coordination notes:
  - `phase-156` is settings IA scope and explicitly avoids inbox/analytics runtime behavior; no direct file overlap with this subphase (`cron/background-jobs`, `lib/inngest/*`, `lib/background-jobs/maintenance.ts`).
  - Prior phases 154/155 touched cron and Inngest scaffolding; this subphase is additive parity hardening on those same paths.
  - Untracked `docs/planning/phase-156/` and `lib/background-jobs/maintenance.ts` were treated as intentional concurrent-agent work per user instruction and integrated without revert.

## RED TEAM Pass (post-implementation)
- Closed risks:
  - `BACKGROUND_JOBS_USE_INNGEST=true` no longer drops maintenance behavior.
  - Enqueue failures no longer hard-fail the cron tick without processing fallback.
- Remaining rollout risks:
  - Env hygiene is still operationally configured, not code-enforced:
    - Preview must not set `INNGEST_ENV=production`.
    - Verify per preview deployment: `curl -I https://<preview-url>/api/inngest | rg -i x-inngest-env`.
  - Production cutover should still be canary-gated (`5% -> 25% -> 100%`) with rollback via `BACKGROUND_JOBS_USE_INNGEST=false`.
