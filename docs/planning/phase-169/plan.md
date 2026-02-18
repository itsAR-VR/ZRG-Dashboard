# Phase 169 — Log-driven Inngest offload for failing webhook + cron routes

## Purpose
Break the log-driven timeout/retry “reversal loop” by moving eligible high-error routes (webhook + cron) off the synchronous request path into durable execution (Inngest + existing DB queues), while keeping user-facing inbox read APIs synchronous.

## Context
- Primary evidence: `zrg-dashboard-log-export-2026-02-17T21-43-29.json` (39,385 rows, deployment `dpl_H5eNbGu6SeiTpeJtvwQsLrpFZERz`).
- Note: `requestPath` values in the export include the host prefix (e.g. `zrg-dashboard.vercel.app/api/webhooks/email`). Normalize by stripping the host when bucketing routes.
- Dominant failing routes/signatures from the export (counts include only rows with a present `responseStatusCode`; blank status rows are “missing response” entries):
  - `/api/webhooks/email`: `21,050` × `504` + `310` × blank status (dominant 60s runtime timeouts; Phase 53 queue-first mode exists via `INBOXXIA_EMAIL_SENT_ASYNC`).
  - `/api/inbox/conversations`: `8,718` × `504` + `4,938` × `500` + `1,443` × blank status (user-facing read; keep synchronous; reduce contention by offloading other work).
  - `/api/cron/response-timing`: `545` × `500` + `18` × blank status (expired transactions / contention).
  - `/api/cron/background-jobs`: `77` × `500` (observed `query_wait_timeout`; route should be dispatch-only to Inngest per Phase 165, so this indicates rollout/config drift or emergency inline fallback).
  - Additional cron routes showing timeouts/contention in this export:
    - `/api/cron/appointment-reconcile`: `120` × `500` + `74` × `504`
    - `/api/cron/followups`: `149` × `500` + `16` × `504`
    - `/api/cron/availability`: `156` × `504`
    - `/api/cron/emailbison/availability-slot`: `190` × `504` + `4` × blank status
- Existing work to integrate (do not redo):
  - Phase 53: durable `WebhookEvent` queue + `INBOXXIA_EMAIL_SENT_ASYNC` (queue-first for Inboxxia `EMAIL_SENT` bursts), drained via `lib/webhook-events/runner.ts` with env budgets.
  - Phase 165: background dispatch window ledger + Inngest functions for background processing; `/api/cron/background-jobs` already supports dispatch-only mode based on `INNGEST_EVENT_KEY` / `BACKGROUND_JOBS_USE_INNGEST`.
  - Phase 167/168: timeout hardening + live perf verification; this phase provides the durable offloads used by those verification loops.

## Strict Reversal Loop Protocol (repeat per iteration)
1. Capture a **baseline** Vercel dashboard log export for a fixed window (same filters each time).
2. Attribute the top failure signatures to 1–2 eligible routes (webhook/cron only).
3. Apply one migration slice:
   - route becomes **dispatch-only** to Inngest (or queue-first via `WebhookEvent`) with deterministic idempotency keys
   - concurrency is capped so we reduce DB contention instead of amplifying it
4. Capture a **post-change** export for the same window and compare deltas.
5. Only move on to the next route once the target signature materially drops.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 165 | Active | Shares background orchestration surfaces (`app/api/cron/background-jobs`, `lib/background-jobs/*`) | Re-read files before changes; keep migration gating aligned with the dispatch ledger/flagging already surfaced there. |
| Phase 167 | Active | Runtime/perf hardening for inbox and webhook entry points | Coordinate on shared handler files and avoid duplicating concurrency contracts. |
| Phase 168 | Complete (`partially confirmed`) | Live-performance verification + log analysis for cron+inbox routes | Treat Phase 168 artifacts as baseline context; use Phase 169 residual-risk bridge evidence for cohesion. |
| Working tree | Active | Ongoing edits in `README.md`, `docs/planning/phase-165/*`, `lib/inngest/*`, `lib/background-jobs/*`, `app/api/cron/background-jobs/route.ts`, untracked logs/artifacts, new `docs/planning/phase-168/` folder, and schema/test files | Keep merges small and coordinated; do not overwrite other phase’s changes. |

## Phase 168 Residual Risk Coverage (Cohesion)
- Bridge artifact: `docs/planning/phase-169/artifacts/phase-168-residual-risk-closure-2026-02-18T06-30-00Z.md`
- Risk mapping:
  - `/api/cron/emailbison/availability-slot` timeout branch from Phase 168 is addressed operationally in Phase 169 via dispatch + durable `SUCCEEDED` evidence.
  - strict matched-window dashboard-export parity remains open and is tracked in this phase’s open questions.

## Objectives
* [x] Produce a decision-complete migration matrix for the failing routes in this export (what migrates vs stays sync, and why).
* [x] Lock Inngest event contracts (names, payloads, deterministic ids/idempotency keys) and concurrency caps for each migrated route.
* [x] Implement the migrations in small slices, preserving existing workflows:
  - webhook remains an HTTP ingest endpoint, but switches to queue-first behavior where applicable
  - cron endpoints remain Vercel Cron targets, but become dispatch-only to Inngest when enabled
* [ ] Verify each slice with paired Vercel dashboard exports before moving to the next route.

## Flag Strategy (minimal + rollback-friendly)
- Webhook offload:
  - `INBOXXIA_EMAIL_SENT_ASYNC=true` (Phase 53; queue-first `EMAIL_SENT`)
- Background jobs offload (Phase 165):
  - `INNGEST_EVENT_KEY` present (auto-enables dispatch) or `BACKGROUND_JOBS_USE_INNGEST=true`
  - keep `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK` disabled by default
- Cron dispatch offloads (new; one per route so we can roll back independently):
  - `CRON_RESPONSE_TIMING_USE_INNGEST=true|false`
  - `CRON_APPOINTMENT_RECONCILE_USE_INNGEST=true|false`
  - `CRON_FOLLOWUPS_USE_INNGEST=true|false`
  - `CRON_AVAILABILITY_USE_INNGEST=true|false`
  - `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST=true|false`

## Constraints
- No unrelated Prisma/schema/domain refactors; keep this work focused on request-to-Inngest migration.
- Preserve existing cron/webhook auth + secret checks even though the Inngest event is published asynchronously.
- Keep Rollbar/Vercel log correlation intact by including request IDs in the Inngest payload and the resulting run record.
- Keep `/api/inbox/*` synchronous (do not “move reads to Inngest”; reduce contention by offloading other work).
- Do not ship a migration without an explicit rollback flag per migrated route.
- Live verification must capture Vercel dashboard exports for both the baseline and final runs.
- Do not change Vercel cron schedules (“no throttling”) unless explicitly declared as break-glass.

## RED TEAM Findings (Gaps / Weak Spots)
- Secret integrity risk:
  - `INNGEST_SIGNING_KEY` (and previously `CRON_SECRET`) accepted trailing whitespace/newline and caused runtime failures.
  - Mitigation: trim + whitespace-assert critical secrets before deploy and confirm via pulled env checks.
- Observability interpretation risk:
  - `BackgroundDispatchWindow.status=ENQUEUED` is dispatch-state, not completion-state.
  - Mitigation: use `BackgroundFunctionRun` terminal states as source of truth for execution health.
- Verification parity gap:
  - Vercel CLI streaming logs are not equivalent to dashboard export windows for strict route-signature deltas.
  - Mitigation: attach dashboard-export evidence before declaring full phase success.
- Probe URL construction gap:
  - `NEXT_PUBLIC_APP_URL` in env may include trailing `/`; naive concatenation can produce `//api/...` and false `308` probe results.
  - Mitigation: strip trailing slash or force redirect-follow in operator probe commands.

## Success Criteria
- Baseline + post-change Vercel dashboard exports are attached for each iteration slice.
- `Task timed out after 60 seconds` on `/api/webhooks/email` materially drops in the post-change window (target: no sustained burst patterns; exact threshold set per iteration window size).
- Cron routes migrated to dispatch-only stop producing 500/504 bursts attributable to long inline execution:
  - `/api/cron/response-timing` 500s drop materially and no longer show “expired transaction” clusters.
  - `/api/cron/background-jobs` shows dispatch-only mode and stops emitting query_wait_timeout inline failures.
  - additional cron routes migrated in later slices show similar reductions.
- Durable execution is observable:
  - Inngest function runs appear in `BackgroundFunctionRun` (via `writeInngestJobStatus`) and are not stuck in RUNNING/FAILED loops.
  - `WebhookEvent` queue is draining (no sustained growth in pending-due rows).
- Safety gates pass (required due message/webhook/cron workflow impact):
  - `npm run lint`
  - `npm run build`
  - `npm test`
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --concurrency 3`
  - fallback only when manifest is unavailable: `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20` then `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
  - replay evidence includes artifact path, `judgePromptKey`, `judgeSystemPrompt`, and per-case `failureType` counts

## Rollback
- Flip the route-specific env flag(s) to `false` and confirm the route returns to inline behavior.
- For webhook offload, flip `INBOXXIA_EMAIL_SENT_ASYNC=false` (returns to legacy sync path; use only as emergency).
- Document rollback evidence with a post-rollback dashboard export and a short operator timeline.

## Subphase Index
* a — Log triage + migration matrix (routes/signatures/eligibility)
* b — Inngest contracts + rollout flags (idempotency + concurrency)
* c — Implement offloads (webhook + cron dispatch-only)
* d — Verify + iterate (exports + rollback)

## Uncommitted Files
- `README.md` (phase-165/ongoing doc updates).
- `app/api/cron/background-jobs/route.ts` (phase-165 refactor that shares dispatch helper surfaces).
- `docs/planning/phase-165/*` (a–e plans in flight and coordinated rewrites).
- `lib/inngest/events.ts`, `lib/inngest/functions/*`, `lib/inngest/job-status.ts` (phase-165 wiring already touched; re-read before editing).
- `lib/background-jobs/dispatch*.ts`, `lib/background-jobs/runner.ts`, `lib/background-jobs/maintenance.ts` (phase-165 core logic, only extend if migration requires).
- `prisma/schema.prisma` + `README.md` updates (ongoing schema sync/vision).
- `lib/__tests__/background-dispatch.test.ts` (new test coverage not committed yet).
- Untracked files/folders: `.env.example`, `artifacts/live-env-playwright/*`, `docs/planning/phase-168/`, `lib/background-jobs/dispatch.ts`, `lib/background-jobs/dispatch-ledger.ts`, `zrg-dashboard-log-export-2026-02-17T18-12-24.json`, `zrg-dashboard-log-export-2026-02-17T21-43-29.json`.

## Phase Summary (running)
- 2026-02-18T01:59:22Z (UTC) — Completed subphase 169a by shipping the normalized log-driven decision matrix and locked P0/P1 route iteration order (files: `docs/planning/phase-169/artifacts/log-driven-matrix.md`, `docs/planning/phase-169/a/plan.md`, `docs/planning/phase-169/plan.md`).
- 2026-02-18T02:01:26Z (UTC) — Completed subphase 169b with a decision-complete Inngest offload contract spec and manifest-first NTTAN hardening for implementation gates (files: `docs/planning/phase-169/artifacts/inngest-offload-spec.md`, `docs/planning/phase-169/b/plan.md`, `docs/planning/phase-169/c/plan.md`, `docs/planning/phase-169/plan.md`).
- 2026-02-18T02:29:58Z (UTC) — Completed subphase 169c implementation + validation (lint/build/tests + full NTTAN replay runs) and prepared manifest-driven replay evidence artifacts (files: `app/api/cron/response-timing/route.ts`, `app/api/cron/appointment-reconcile/route.ts`, `app/api/cron/followups/route.ts`, `app/api/cron/availability/route.ts`, `app/api/cron/emailbison/availability-slot/route.ts`, `lib/cron/*`, `lib/inngest/cron-dispatch.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/index.ts`, `lib/inngest/functions/cron-*.ts`, `docs/planning/phase-169/c/plan.md`, `docs/planning/phase-169/replay-case-manifest.json`).
- 2026-02-18T03:20:04Z (UTC) — Completed first production verification slice for `/api/cron/response-timing` with dispatch-only evidence captured (`post-response-timing-response-body-2026-02-18T03-19-35Z.txt`) and paired baseline artifacts under `docs/planning/phase-169/artifacts/`.
- 2026-02-18T03:34:33Z (UTC) — Completed rollback rehearsal for `/api/cron/response-timing`: set `CRON_RESPONSE_TIMING_USE_INNGEST=false`, redeployed, and captured authorized inline HTTP 200 evidence (`rollback-response-timing-response-body-2026-02-18T03-33-46Z.txt`), plus operator timeline and durable snapshots.
- 2026-02-18T03:34:33Z (UTC) — New blocker recorded: `BackgroundFunctionRun` has no `cron-response-timing` rows in production snapshots (`durable-health-response-timing-2026-02-18T03-28-49Z.json`, `rollback-durable-health-response-timing-2026-02-18T03-34-33Z.json`), so durable-run success is not yet verifiable.
- 2026-02-18T03:42:05Z (UTC) — Manual Inngest probes accepted events for `cron/response-timing.requested` but still produced zero durable run rows across all probe dispatch keys (`manual-probe-durable-check-2026-02-18T03-42-05Z.json`), confirming a broader durable-observability gap beyond the cron flag.
- 2026-02-18T05:47:36Z (UTC) — Root cause identified: `inngest/function.failed` events showed `Invalid signature` (`401`) for background and response-timing functions; traced to trailing whitespace/newline in production `INNGEST_SIGNING_KEY` (evidence: `inngest-invalid-signature-evidence-2026-02-18T05-47-35Z.json`).
- 2026-02-18T05:50Z–05:57Z (UTC) — Remediated signing key (trimmed) + redeployed; post-fix window showed zero new `Invalid signature` failures and durable run ledger repopulation (`inngest-failure-window-after-signing-fix-2026-02-18T05-57-03Z.json`, `inngest-post-signing-fix-check-2026-02-18T05-51-06Z.json`).
- 2026-02-18T05:55:38Z (UTC) — Re-enabled `CRON_RESPONSE_TIMING_USE_INNGEST=true` and re-verified dispatch slice with durable `cron-response-timing` success (`post-fix-response-timing-dispatch-check-2026-02-18T05-56-47Z.json`).
- 2026-02-18T06:00:09Z (UTC) — Enabled next slice `CRON_APPOINTMENT_RECONCILE_USE_INNGEST=true`; route dispatch verified and durable run present (`RUNNING`) (`post-fix-appointment-reconcile-dispatch-check-2026-02-18T05-59-49Z.json`).
- 2026-02-18T06:06:20Z (UTC) — Appointment-reconcile durable ledger now shows newer windows completing (`SUCCEEDED`) while the initial 05:59 window remains `RUNNING`; added cleanup-risk tracking (`post-fix-appointment-reconcile-ledger-2026-02-18T06-06-20Z.json`).
- 2026-02-18T06:12:48Z (UTC) — Confirmed followups slice health (`CRON_FOLLOWUPS_USE_INNGEST=true`): durable runs for `06:09`–`06:12` all `SUCCEEDED`, and the earlier appointment `05:59` run self-healed to `SUCCEEDED` (`post-fix-followups-ledger-2026-02-18T06-12-47Z.json`).
- 2026-02-18T06:15:54Z (UTC) — Enabled and verified availability slice (`CRON_AVAILABILITY_USE_INNGEST=true`) with dispatch-only `202` and durable `cron-availability` `SUCCEEDED` row (`post-fix-availability-dispatch-check-2026-02-18T06-15-51Z.json`).
- 2026-02-18T06:19:20Z (UTC) — Enabled and verified emailbison availability-slot slice (`CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST=true`): dispatch `202`, first durable snapshot `RUNNING`, then terminal `SUCCEEDED` (`post-fix-emailbison-availability-slot-ledger-2026-02-18T06-18-30Z.json`).
- 2026-02-18T06:24:15Z (UTC) — Normalized trailing-newline production booleans (`CRON_AVAILABILITY_USE_INNGEST`, `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST`, `BACKGROUND_JOBS_USE_INNGEST`, `INBOXXIA_EMAIL_SENT_ASYNC`), redeployed, and verified post-fix env whitespace audit + dispatch sanity probe (`post-fix-env-whitespace-check-2026-02-18T06-24-14Z.json`, `post-fix-response-timing-sanity-response-2026-02-18T06-24-14Z.txt`).
- 2026-02-18T06:25:14Z (UTC) — Captured `WebhookEvent` queue snapshot after full cron rollout; no due/running backlog observed (`duePending=0`, `dueFailed=0`, `runningCount=0`) (`post-fix-webhookevent-queue-snapshot-2026-02-18T06-25-13Z.json`).
- 2026-02-18T06:47:11Z (UTC) — Added cross-phase cohesion bridge that maps Phase 168 residual risks to Phase 169 evidence, marking emailbison timeout branch as operationally addressed and dashboard-export parity as the remaining verification gap (files: `docs/planning/phase-169/plan.md`, `docs/planning/phase-169/d/plan.md`, `docs/planning/phase-169/artifacts/phase-168-residual-risk-closure-2026-02-18T06-30-00Z.md`).

## Open Questions (Need Human Input)
- [ ] Can you provide or attach matched-window Vercel dashboard exports for all post-fix windows (`response-timing`, `appointment-reconcile`, `followups`, `availability`, `emailbison/availability-slot`) so we can close strict route-signature delta criteria?
  - Why it matters: CLI/runtime probes + durable rows confirm execution health, but success criteria explicitly require dashboard-export route/signature deltas.
  - Current assumption in this plan: keep rollout status as "operationally healthy but verification-incomplete" until dashboard export packets are attached.
