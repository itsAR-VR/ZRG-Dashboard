# Phase 169a Artifact — Log-Driven Migration Matrix

## Dataset + Normalization
- Source file: `zrg-dashboard-log-export-2026-02-17T21-43-29.json`
- Rows: `39,385`
- Deployment: `dpl_H5eNbGu6SeiTpeJtvwQsLrpFZERz`
- Route normalization: strip host prefix from `requestPath` and keep the `/api/...` suffix for bucketing.

## Target Route Buckets (normalized)

| Route | 500 | 504 | blank status | 200 | Total rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/api/webhooks/email` | 0 | 21,050 | 310 | 0 | 21,360 |
| `/api/inbox/conversations` | 4,938 | 8,718 | 1,443 | 0 | 15,099 |
| `/api/cron/background-jobs` | 77 | 0 | 0 | 556 | 633 |
| `/api/cron/response-timing` | 545 | 0 | 18 | 0 | 563 |
| `/api/cron/appointment-reconcile` | 120 | 74 | 0 | 271 | 465 |
| `/api/cron/followups` | 149 | 16 | 0 | 0 | 165 |
| `/api/cron/availability` | 0 | 156 | 0 | 0 | 156 |
| `/api/cron/emailbison/availability-slot` | 0 | 190 | 4 | 0 | 194 |

## Runtime Duration Evidence (`durationMs > 0`)

| Route | Count | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| `/api/webhooks/email` | 9,978 | 562ms | 60,001ms | 60,002ms |
| `/api/inbox/conversations` | 10,067 | 2,194ms | 300,001ms | 300,001ms |
| `/api/cron/background-jobs` | 123 | 206,113ms | 412,795ms | 454,080ms |
| `/api/cron/response-timing` | 421 | 5,047ms | 13,677ms | 17,618ms |
| `/api/cron/appointment-reconcile` | 204 | 120,332ms | 800,001ms | 800,057ms |
| `/api/cron/followups` | 84 | 120,220ms | 120,441ms | 800,041ms |
| `/api/cron/availability` | 117 | 60,001ms | 60,060ms | 60,143ms |
| `/api/cron/emailbison/availability-slot` | 116 | 60,001ms | 60,058ms | 60,143ms |

## Decision-Complete Migration Matrix

| Route | Failure counts (500/504/blank) | Dominant error signatures | Workflow criticality | Offload mechanism | Proposed event name | Deterministic idempotency key | Concurrency cap | Rollback flag(s) | Owner files | Cross-phase dependency notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/webhooks/email` | `0 / 21,050 / 310` | `timeout_60s (4,985)`; remaining failure rows mostly non-terminal webhook log lines on timed-out requests | P0 | Keep HTTP ingest, enforce queue-first for `EMAIL_SENT` via `WebhookEvent` | n/a (DB queue path) | `dedupeKey = inboxxia:EMAIL_SENT:<scheduledEmailId>` | Queue consumer budgeted by webhook runner env limits (Phase 53); request path stays O(1) enqueue | `INBOXXIA_EMAIL_SENT_ASYNC` | `app/api/webhooks/email/route.ts`, `lib/webhook-events/runner.ts` | Phase 53 owns queue-first primitive; Phase 167/168 own timeout verification loops |
| `/api/inbox/conversations` | `4,938 / 8,718 / 1,443` | `timeout_300s (3,202)`, `P2028 transaction errors (1,267)`, `Unable to start transaction (392)` | P0 (sync SLO) | Keep synchronous read API (not eligible for offload) | n/a | n/a | n/a | n/a | `app/api/inbox/conversations/route.ts` | Explicit non-goal for Phase 169; use this as contention barometer while offloading webhook/cron load (Phase 167/168 overlap) |
| `/api/cron/background-jobs` | `77 / 0 / 0` | `query_wait_timeout (21)` | P0 | Dispatch-only to Inngest (already introduced in Phase 165); keep inline only for explicit force/emergency paths | `background/process.requested`, `background/maintenance.requested` (existing) | `dispatchKey = background-jobs:v1:<windowSeconds>:<windowStartIso>`; event IDs from `buildBackgroundDispatchEventIds(dispatchKey)` | `limit: 1` per background function (existing Phase 165 baseline) | `BACKGROUND_JOBS_USE_INNGEST` (or `INNGEST_EVENT_KEY`), `BACKGROUND_JOBS_FORCE_INLINE`, `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK` | `app/api/cron/background-jobs/route.ts`, `lib/background-jobs/dispatch.ts`, `lib/inngest/functions/process-background-jobs.ts`, `lib/inngest/functions/background-maintenance.ts` | Phase 165 is active and already editing these files; merge semantically and avoid changing dispatch ledger contracts |
| `/api/cron/response-timing` | `545 / 0 / 18` | `P2028 expired transaction (126)`, `Unable to start transaction (8)`, `statement timeout 57014 (7)` | P0 | New dispatch-only cron route to Inngest | `cron/response-timing.requested` | `dispatchKey = cron:response-timing:<UTC-5m-bucket>`; publish `id = cron/response-timing.requested:<dispatchKey>`; function idempotency `event.data.dispatchKey` | `limit: 1` | `CRON_RESPONSE_TIMING_USE_INNGEST` | `app/api/cron/response-timing/route.ts`, `lib/response-timing/processor.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-response-timing.ts` | Shares DB contention surface with Phase 167 fixes; verify with Phase 168-style before/after exports |
| `/api/cron/appointment-reconcile` | `120 / 74 / 0` | `query_wait_timeout (51)`, `timeout_800s (9)`, `unique constraint races (2)` | P1 | New dispatch-only cron route to Inngest (preserve query param semantics) | `cron/appointment-reconcile.requested` | `dispatchKey = cron:appointment-reconcile:<UTC-minute-bucket>:<paramsHash>`; `id = cron/appointment-reconcile.requested:<dispatchKey>`; idempotency `event.data.dispatchKey` | `limit: 1` | `CRON_APPOINTMENT_RECONCILE_USE_INNGEST` | `app/api/cron/appointment-reconcile/route.ts`, `lib/appointment-reconcile-runner.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-appointment-reconcile.ts` | Existing route supports query params; params hash avoids accidental dedupe collisions for manual replays |
| `/api/cron/followups` | `149 / 16 / 0` | `query_wait_timeout (30)`, occasional `timeout_800s (1)` | P1 | New dispatch-only cron route to Inngest | `cron/followups.requested` | `dispatchKey = cron:followups:<UTC-minute-bucket>`; `id = cron/followups.requested:<dispatchKey>`; idempotency `event.data.dispatchKey` | `limit: 1` | `CRON_FOLLOWUPS_USE_INNGEST` | `app/api/cron/followups/route.ts`, `lib/followup-engine.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-followups.ts` | High message workflow impact; NTTAN required before completion (AI/message safety gate) |
| `/api/cron/availability` | `0 / 156 / 0` | `timeout_60s (39)` | P1 | New dispatch-only cron route to Inngest | `cron/availability.requested` | `dispatchKey = cron:availability:<UTC-minute-bucket>`; `id = cron/availability.requested:<dispatchKey>`; idempotency `event.data.dispatchKey` | `limit: 1` | `CRON_AVAILABILITY_USE_INNGEST` | `app/api/cron/availability/route.ts`, `lib/availability-cache.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-availability.ts` | Coordinate with Phase 166 booking logic (availability consumer) but keep scope to cron trigger migration |
| `/api/cron/emailbison/availability-slot` | `0 / 190 / 4` | `timeout_60s (39)` plus route-level status noise entries | P1 | New dispatch-only cron route to Inngest | `cron/emailbison-availability-slot.requested` | `dispatchKey = cron:emailbison-availability-slot:<UTC-minute-bucket>`; `id = cron/emailbison-availability-slot.requested:<dispatchKey>`; idempotency `event.data.dispatchKey` | `limit: 1` | `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST` | `app/api/cron/emailbison/availability-slot/route.ts`, `lib/emailbison-first-touch-availability.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-emailbison-availability-slot.ts` | Shares availability pressure with `/api/cron/availability`; stage after P0 to avoid widening blast radius |

## Iteration Order (locked)

### P0 (execute first)
1. `/api/webhooks/email` queue-first verification (`INBOXXIA_EMAIL_SENT_ASYNC=true` in target env) and queue-drain validation.
2. `/api/cron/background-jobs` dispatch-only verification in production settings (`INNGEST_EVENT_KEY` / `BACKGROUND_JOBS_USE_INNGEST`), no implicit inline fallback.
3. `/api/cron/response-timing` dispatch-only migration behind `CRON_RESPONSE_TIMING_USE_INNGEST`.

### P1 (only after P0 deltas materially improve)
1. `/api/cron/appointment-reconcile`
2. `/api/cron/followups`
3. `/api/cron/availability`
4. `/api/cron/emailbison/availability-slot`

## Keep-Sync Verification Targets
- `/api/inbox/conversations`
- `/api/inbox/counts`

These remain synchronous; use their 500/504/timeout signatures as contention indicators while webhook/cron routes are offloaded.
