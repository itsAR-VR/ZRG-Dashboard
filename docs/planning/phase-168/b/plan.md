# Phase 168b — Root Cause Attribution Matrix (Timeout/500/Latency)

## Focus
Turn raw evidence into a decision-ready attribution matrix that identifies the top bottlenecks driving perceived slowness.

## Inputs
- Baseline packet from Phase 168a
- `docs/planning/phase-168/artifacts/log-forensics-2026-02-17T21-43-29.md`
- Prior perf/timeout findings from Phases 163, 164, and 167
- Current uncommitted timeout-hardening changes in working tree

## Work
1. Lock the attribution matrix using the latest export (`39,385` rows, deployment `dpl_H5eNbGu6SeiTpeJtvwQsLrpFZERz`):
   - `/api/webhooks/email` → `timeout_60s` (`4,985`)
   - `/api/inbox/conversations` → `timeout_300s` (`3,202`), `P2028` (`1,267`), transaction-start timeout (`392`)
   - `/api/cron/response-timing` → expired transaction / `P2028` (`127`) + additional `500`s
   - cross-route `query_wait_timeout` (`419`) across inbox/home + multiple cron routes
   - correlate any “reversal loop” signature (repeat cycles across webhook + cron + inbox in the same window)
2. Map each class to owner code paths:
   - webhook email: `app/api/webhooks/email/route.ts`
   - inbox read path: `app/api/inbox/conversations/route.ts`, `app/api/inbox/counts/route.ts`, `actions/lead-actions.ts`
   - response timing cron + analytics read path: `app/api/cron/response-timing/route.ts`, `lib/response-timing/processor.ts`, `app/api/analytics/response-timing/route.ts`, `actions/response-timing-analytics-actions.ts`
   - background contention: `vercel.json`, `app/api/cron/background-jobs/route.ts`, `lib/background-jobs/runner.ts`
3. Confirm confounders and classify as secondary:
   - transient downstream API issues (`API 502`, `fetch failed`) are low-frequency and not the dominant slowdown source
   - unique constraint races in reconcile are present but not primary throughput drivers
   - `P2010` and `client_login_timeout` are treated as contention byproducts unless they persist after primary fixes
4. Produce a decision-complete minimum fix set for Phase 168c:
   - deploy current timeout/perf hardening code (same file set as Phase 167 overlap)
   - confirm/enable queue-first EMAIL_SENT handling (`INBOXXIA_EMAIL_SENT_ASYNC=true`) and confirm `WebhookEvent` is present + draining
   - confirm background-jobs runs in dispatch-only mode to Inngest (Phase 165) and emergency inline fallback is disabled by default
   - if additional cron routes need Inngest offload, execute under Phase 169 (do not change Vercel cron schedules here)
   - verify post-change signature deltas via paired Vercel dashboard exports for a fixed 30–60 minute window
5. Enforce Phase 169 coordination boundaries in the matrix:
   - Phase 168c may harden existing inline paths and diagnostics, but does not add new Inngest route migrations.
   - Any fix recommendation requiring new `*_USE_INNGEST` route flags is marked as `Phase 169 dependency` with status (`ready` / `in-progress` / `blocked`).
   - Record shared-file collision risk for `app/api/webhooks/email/route.ts`, `app/api/cron/response-timing/route.ts`, and `app/api/cron/background-jobs/route.ts`.
6. Capture configuration-state evidence needed for Phase 168d comparability:
   - create a baseline flag snapshot artifact (`docs/planning/phase-168/artifacts/flags-baseline-<windowStartUtc>.md`)
   - include observed values (or explicit unknown) for `INBOXXIA_EMAIL_SENT_ASYNC`, `INNGEST_EVENT_KEY` presence, `BACKGROUND_JOBS_USE_INNGEST`, and `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK`
   - require a matching post-fix flag snapshot in Phase 168d before issuing final verdict

## Validation (RED TEAM)
- Re-run the `jq` slices used in Phase 168a (`log-forensics-2026-02-17T21-43-29.json`) to confirm timeout/500 tallies match the matrix before making fix decisions.
- Confirm `INBOXXIA_EMAIL_SENT_ASYNC` and `BACKGROUND_JOBS_USE_INNGEST` remain in the expected state via environment checks before locking down the fix order.
- Verify no additional cron routes were added by inspecting `vercel.json` (`cat vercel.json | jq '.crons[].path'`) to avoid stray dependencies.

## Current Findings Snapshot
- Root-cause status: **confirmed cluster** (not a single isolated error).
- Primary driver 1: synchronous webhook burst handling (`EMAIL_SENT` dominates timeout-correlated request IDs).
- Primary driver 2: inbox query path saturation under load (300s runtime timeouts + transaction contention).
- Primary driver 3: response-timing cron transaction envelope too tight in deployed version.
- Systemic amplifier: concurrent cron workload increases DB wait pressure (`query_wait_timeout`) across independent routes.

## Expected Output
- `docs/planning/phase-168/artifacts/root-cause-matrix-<windowStartUtc>-<windowEndUtc>.md` containing prioritized bottlenecks, secondary contributors, fix ranking, and evidence references.

## Output
- Root-cause matrix artifact with explicit failing signatures, owner files, and Phase 169 dependency boundaries:
  - `docs/planning/phase-168/artifacts/root-cause-matrix-2026-02-17T21-13-00Z-2026-02-17T21-43-00Z.md`

## Expected Handoff
Provide prioritized fix order and acceptance thresholds to Phase 168c.

## Handoff
- Deliver matrix artifact to 168c with clear ownership split:
  - Phase 168 owns env/inline hardening + hotfixes.
  - Phase 169 owns new route migrations/event contracts.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added Phase 169 boundary enforcement requirements directly into the matrix workstream.
  - Added flag-state snapshot requirements so 168d comparisons can prove env stability between baseline and post-fix windows.
  - Confirmed this subphase can consume existing forensics artifacts from 168a while awaiting operator live-window packets.
- Commands run:
  - Reused command outputs and artifact references from `docs/planning/phase-168/a/plan.md`.
- Blockers:
  - Operator-provided live artifacts are still required before final 168d verdict work.
- Next concrete steps:
  - Finalize `root-cause-matrix-<windowStartUtc>-<windowEndUtc>.md` artifact from confirmed findings.
  - Execute 168c on the locked inline-hardening scope with no new Inngest route migrations.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Materialized the missing attribution matrix artifact using canonical baseline signatures and owner-path mapping.
  - Linked the matrix to the 168c decision boundary (what 168 changed vs what 169 owns).
- Commands run:
  - `cat > docs/planning/phase-168/artifacts/root-cause-matrix-2026-02-17T21-13-00Z-2026-02-17T21-43-00Z.md` — pass.
- Blockers:
  - None for 168b.
- Next concrete steps:
  - Keep matrix as source-of-truth reference for any follow-on tuning work after 168 closeout.
