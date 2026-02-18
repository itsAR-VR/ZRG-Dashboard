# Phase 169b — Inngest contracts + rollout flags (idempotency + concurrency)

## Focus
Define the Inngest contracts for the migrated webhook/cron routes: event names, payload contract, deterministic event IDs/idempotency keys, retries, concurrency caps, and the minimal flag/rollback strategy that keeps workflows stable while breaking the timeout/retry “reversal loop”.

## Inputs
- Phase 169a output: `docs/planning/phase-169/artifacts/log-driven-matrix.md`
- Existing Inngest scaffolding:
  - `app/api/inngest/route.ts`
  - `lib/inngest/client.ts`
  - `lib/inngest/events.ts`
  - `lib/inngest/job-status.ts` (writes `BackgroundFunctionRun` + Redis status)
  - `lib/inngest/functions/*` and `lib/inngest/functions/index.ts`
- Existing durable offload primitives:
  - Phase 53 `WebhookEvent` queue + `INBOXXIA_EMAIL_SENT_ASYNC` in `app/api/webhooks/email/route.ts`
  - Phase 165 background dispatch ledger pattern in `app/api/cron/background-jobs/route.ts`

## Work
1. Lock the “what migrates” list:
   - Webhook + cron routes migrate (dispatch-only / queue-first).
   - `/api/inbox/*` stays synchronous (verification targets only).
2. Event naming convention (Inngest):
   - `cron/response-timing.requested`
   - `cron/appointment-reconcile.requested`
   - `cron/followups.requested`
   - `cron/availability.requested`
   - `cron/emailbison-availability-slot.requested`
3. Payload contract (cron dispatch events):
   - Reuse the Phase 165 shape (`BackgroundDispatchEventData`) for consistency:
     - `source`, `requestedAt`, `dispatchKey`, `correlationId`, `dispatchWindowStart`, `dispatchWindowSeconds`
   - Add optional `params` only where a cron currently accepts query params (e.g. appointment reconcile).
4. Deterministic idempotency keys:
   - When publishing, set `id: <eventName>:<dispatchKey>` (Inngest event de-dupe by `id`).
   - In function config, set `idempotency: "event.data.dispatchKey"`.
   - DispatchKey rules (decision-complete; no implementer choice):
     - Minutely crons: `cron:<job>:<UTC YYYY-MM-DDTHH:mm>` (floor to minute)
     - 5-minute crons: floor to the 5-minute bucket
5. Concurrency caps (start conservative to reduce DB contention):
   - `concurrency: { limit: 1 }` per function
   - If later evidence shows safe parallelism, increase only with an explicit export-based justification.
6. Retries:
   - Start with `retries: 3` for cron functions; increase only if failures are transient and not load-amplifying.
7. Flag/rollback strategy (minimal, per route):
   - Webhook offload: `INBOXXIA_EMAIL_SENT_ASYNC=true|false` (already exists).
   - Background jobs offload (Phase 165): dispatch-only is enabled by `INNGEST_EVENT_KEY` presence or `BACKGROUND_JOBS_USE_INNGEST=true`.
   - New per cron route (one each; rollback = flip to false):
     - `CRON_RESPONSE_TIMING_USE_INNGEST=true|false`
     - `CRON_APPOINTMENT_RECONCILE_USE_INNGEST=true|false`
     - `CRON_FOLLOWUPS_USE_INNGEST=true|false`
     - `CRON_AVAILABILITY_USE_INNGEST=true|false`
     - `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST=true|false`
8. Observability requirements (must be in spec):
   - Every dispatch-only cron route response includes `dispatchKey`, `correlationId`, and published event IDs (when available).
   - Every Inngest function writes durable run status via `writeInngestJobStatus` (jobName fixed per function).

## Expected Output
- `docs/planning/phase-169/artifacts/inngest-offload-spec.md` containing:
  - route → event name → payload → event.id derivation → function idempotency → concurrency → retries → flags → rollback
  - required response/log fields for correlation with Vercel logs

## Output
- Added `docs/planning/phase-169/artifacts/inngest-offload-spec.md` as the implementation source of truth for 169c, including:
  - migrated vs keep-sync route lock
  - canonical event names for all new cron offloads
  - shared payload contract (`BackgroundDispatchEventData` + optional `params`)
  - deterministic `dispatchKey` / `event.id` derivations per route
  - function contract (`retries: 3`, `concurrency: { limit: 1 }`, `idempotency: event.data.dispatchKey`)
  - route dispatch response contract (202 mode + correlation metadata; no implicit inline fallback on enqueue failure)
  - per-route flags + rollback controls
  - route-to-owner-file mapping for direct implementation handoff
  - observability + validation gate requirements (including manifest-first NTTAN)
- RED TEAM hardening applied:
  - aligned root/subphase validation commands to manifest-first replay syntax with explicit fallback path
  - captured requirement to report replay artifact path, `judgePromptKey`, `judgeSystemPrompt`, and `failureType` counts

## Expected Handoff
Use the spec as the sole source of truth for implementation in Phase 169c (no new decisions during coding).

## Handoff
- Implement 169c strictly against `docs/planning/phase-169/artifacts/inngest-offload-spec.md`; avoid contract drift unless post-change exports force a spec update.
- First implementation slice should target P0 routes in order: background-jobs config verification, response-timing dispatch-only conversion, then webhook queue-first verification.
- Keep response payloads stable and only append dispatch metadata under a dedicated field.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Re-read existing Inngest scaffolding (`lib/inngest/events.ts`, `lib/inngest/functions/*`, `lib/inngest/job-status.ts`) to anchor contracts to current runtime behavior.
  - Authored the complete offload contract spec for all Phase 169 migration targets.
  - Patched root/subphase validation plans to satisfy manifest-first NTTAN requirements.
- Commands run:
  - `cat lib/inngest/functions/process-background-jobs.ts` — pass (confirmed current retries/concurrency/idempotency pattern).
  - `cat lib/inngest/functions/background-maintenance.ts` — pass (confirmed status-writer usage pattern).
  - `cat lib/inngest/functions/index.ts` and `cat lib/inngest/job-status.ts` — pass (verified registration and durable run schema expectations).
  - `cat > docs/planning/phase-169/artifacts/inngest-offload-spec.md <<'EOF' ... EOF` — pass (spec written to disk).
- Blockers:
  - None for subphase 169b.
- Next concrete steps:
  - Execute 169c implementation slices in code (events/constants, new Inngest function modules, route dispatch-only gates).
