# Phase 169c — Implement offloads (webhook + cron dispatch-only)

## Focus
Implement the Phase 169b spec as small, rollback-friendly slices: convert selected failing cron routes to dispatch-only Inngest triggers (with deterministic idempotency + conservative concurrency), and ensure webhook `EMAIL_SENT` processing is queue-first and draining via background workers.

## Inputs
- Phase 169b output: `docs/planning/phase-169/artifacts/inngest-offload-spec.md`
- Existing Inngest dispatch reference: `app/api/cron/background-jobs/route.ts` (Phase 165)
- Webhook queue-first reference: `app/api/webhooks/email/route.ts` (Phase 53)
- Job status ledger writer: `lib/inngest/job-status.ts` → `BackgroundFunctionRun`
- Target cron routes:
  - `app/api/cron/response-timing/route.ts`
  - `app/api/cron/appointment-reconcile/route.ts`
  - `app/api/cron/followups/route.ts`
  - `app/api/cron/availability/route.ts`
  - `app/api/cron/emailbison/availability-slot/route.ts`

## Work
### Pre-flight conflict check (multi-agent)
- Run `git status --porcelain` and re-read any already-modified overlapping files from Phase 165/167/168 before editing.

### Slice 0 — Ensure existing offloads are actually usable in production
1. Webhook queue-first:
   - Confirm `INBOXXIA_EMAIL_SENT_ASYNC` is enabled in the target environment.
   - Confirm `WebhookEvent` table exists (Phase 53) and the enqueue path does not do additional heavy work.
2. Background jobs dispatch-only (Phase 165):
   - Confirm Inngest dispatch is enabled (presence of `INNGEST_EVENT_KEY` or `BACKGROUND_JOBS_USE_INNGEST=true`).
   - Confirm emergency inline fallback is disabled by default.

### Slice 1 — Add Inngest event constants + functions for migrated crons
1. Update `lib/inngest/events.ts`:
   - Add event constants for each cron route selected in the spec.
2. Add new function modules under `lib/inngest/functions/` (one per cron):
   - Each function:
     - uses `inngest.createFunction({ id, retries, concurrency, idempotency }, { event }, handler)`
     - calls `writeInngestJobStatus` on running/succeeded/failed
     - executes the existing cron core logic (prefer calling existing `lib/*` helpers; avoid re-implementing business logic)
3. Update `lib/inngest/functions/index.ts` to register the new functions with `/api/inngest`.

### Slice 2 — Convert cron routes to dispatch-only (flagged)
For each migrated route, implement:
1. Keep current `CRON_SECRET` auth checks unchanged.
2. Add `*_USE_INNGEST` flag gating from the spec:
   - if enabled and Inngest is configured, compute `dispatchKey` (time-bucketed, deterministic) + `correlationId`, publish the event with deterministic `id`, return `202` with correlation metadata.
   - if disabled, run the current inline logic unchanged.
3. Do **not** add automatic inline fallback on enqueue failure (rollback path is flipping the flag off).
4. Preserve route response stability: keep existing JSON keys where possible and add new keys under a namespaced field (e.g. `dispatch`).

### Validation (must run before declaring Slice 2 complete)
- `npm run lint`
- `npm run build`
- `npm test`
- NTTAN (required; webhook/cron changes can affect message workflows):
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --concurrency 3`
  - fallback only when manifest is unavailable: `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20` then `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
  - capture replay artifact path, `judgePromptKey`, `judgeSystemPrompt`, and per-case `failureType` counts in subphase output

## Expected Output
- A minimal, slice-based diff that:
  - adds Inngest cron events + functions
  - converts selected cron routes to dispatch-only behind explicit flags
  - preserves inline behavior when flags are off

## Output
- Implemented dispatch-only cron offload wiring for all scoped routes:
  - `app/api/cron/response-timing/route.ts`
  - `app/api/cron/appointment-reconcile/route.ts`
  - `app/api/cron/followups/route.ts`
  - `app/api/cron/availability/route.ts`
  - `app/api/cron/emailbison/availability-slot/route.ts`
- Added shared cron execution/dispatch helpers:
  - `lib/inngest/cron-dispatch.ts` (deterministic dispatch key + event id + params hash handling)
  - `lib/cron/response-timing.ts`
  - `lib/cron/appointment-reconcile.ts`
  - `lib/cron/followups.ts`
  - `lib/cron/availability.ts`
  - `lib/cron/emailbison-availability-slot.ts`
- Added event constants + Inngest consumers and registration:
  - `lib/inngest/events.ts`
  - `lib/inngest/functions/cron-response-timing.ts`
  - `lib/inngest/functions/cron-appointment-reconcile.ts`
  - `lib/inngest/functions/cron-followups.ts`
  - `lib/inngest/functions/cron-availability.ts`
  - `lib/inngest/functions/cron-emailbison-availability-slot.ts`
  - `lib/inngest/functions/index.ts`
- Added replay manifest for manifest-first NTTAN:
  - `docs/planning/phase-169/replay-case-manifest.json`
- Coordination/conflict notes (multi-agent):
  - Shared-file overlap with active Phase 165 work (`lib/inngest/events.ts`, `lib/inngest/functions/index.ts`, `app/api/cron/background-jobs/route.ts`) was handled by re-reading current working-tree versions before edits and avoiding behavior changes to existing background dispatch contracts.
- Validation evidence:
  - `npm run lint` — pass (repo has pre-existing warnings only; no new lint errors)
  - `npm run build` — pass
  - `npm test` — pass (`401` passed, `0` failed)
  - `npm run test:ai-drafts` — pass (`76` passed, `0` failed)
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --dry-run` — pass
    - artifact: `.artifacts/ai-replay/run-2026-02-18T02-16-28-944Z.json`
    - `judgePromptKey`: `meeting.overseer.gate.v1`
    - `judgeSystemPrompt`: `PER_CASE_CLIENT_PROMPT`
    - `failureType` counts: `decision_error=0`, `draft_generation_error=0`, `draft_quality_error=0`, `judge_error=0`, `infra_error=0`, `selection_error=0`, `execution_error=0`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --concurrency 3` — pass
    - artifact: `.artifacts/ai-replay/run-2026-02-18T02-16-33-700Z.json`
    - `judgePromptKey`: `meeting.overseer.gate.v1`
    - `judgeSystemPrompt`: `PER_CASE_CLIENT_PROMPT`
    - `failureType` counts: `decision_error=0`, `draft_generation_error=0`, `draft_quality_error=2`, `judge_error=0`, `infra_error=0`, `selection_error=0`, `execution_error=0`

## Expected Handoff
Provide the deploy metadata + flag values + correlation keys to Phase 169d for export-based verification and rollback rehearsal.

## Handoff
- Deploy this diff and enable one route flag at a time for Phase 169d evidence capture:
  1. `CRON_RESPONSE_TIMING_USE_INNGEST=true`
  2. `CRON_APPOINTMENT_RECONCILE_USE_INNGEST=true`
  3. `CRON_FOLLOWUPS_USE_INNGEST=true`
  4. `CRON_AVAILABILITY_USE_INNGEST=true`
  5. `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST=true`
- Keep webhook queue-first as configured (`INBOXXIA_EMAIL_SENT_ASYNC=true`) and verify background dispatch config (`INNGEST_EVENT_KEY` or `BACKGROUND_JOBS_USE_INNGEST=true`) before collecting post-change exports.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed slice implementation (event contracts, route flags, Inngest function consumers, shared cron helpers).
  - Refactored route-only helper exports into `lib/cron/*` to satisfy Next.js App Router route export constraints.
  - Restored advisory lock logic inside `app/api/cron/followups/route.ts` after test feedback to preserve existing guardrail coverage.
- Commands run:
  - `npm run lint` — pass (pre-existing warnings only).
  - `npm run build` — fail once (invalid extra route exports), then pass after helper refactor.
  - `npm test` — fail once on `lib/__tests__/followups-cron-overlap-lock.test.ts`, then pass after lock logic restoration.
  - `node --import tsx --test lib/__tests__/followups-cron-overlap-lock.test.ts` — pass.
  - `npm run test:ai-drafts` — pass.
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --dry-run` — pass.
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --concurrency 3` — pass.
- Blockers:
  - None for subphase 169c local implementation and validation.
- Next concrete steps:
  - Execute 169d in production: staged flag rollouts, paired Vercel dashboard exports, run-ledger verification, and rollback rehearsal evidence.
