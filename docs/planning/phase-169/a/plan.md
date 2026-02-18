# Phase 169a — Log triage + migration matrix (routes/signatures/eligibility)

## Focus
Convert the 2026-02-17 log export into a decision-complete migration matrix: which failing routes are eligible for offloading to durable execution (Inngest / DB queues), which must remain synchronous, and the exact idempotency/concurrency/rollback controls required to break the timeout/retry “reversal loop”.

## Inputs
- `zrg-dashboard-log-export-2026-02-17T21-43-29.json`
- `docs/planning/phase-168/artifacts/log-forensics-2026-02-17T21-43-29.md`
- `vercel.json` (cron schedules)
- Candidate route handlers:
  - `app/api/webhooks/email/route.ts`
  - `app/api/cron/background-jobs/route.ts` (Phase 165)
  - `app/api/cron/response-timing/route.ts`
  - `app/api/cron/appointment-reconcile/route.ts`
  - `app/api/cron/followups/route.ts`
  - `app/api/cron/availability/route.ts`
  - `app/api/cron/emailbison/availability-slot/route.ts`
  - (read-only SLO sinks, not eligible to migrate): `app/api/inbox/conversations/route.ts`, `app/api/inbox/counts/route.ts`

## Work
1. Normalize + bucket the export:
   - strip host prefixes from `requestPath` into a normalized route key (e.g. `/api/webhooks/email`)
   - bucket by `(normalizedRoute, responseStatusCode)` including blank/missing-status counts
2. Extract the dominant signatures per route:
   - top `message` substrings per failing route (timeouts, `P2028`, `query_wait_timeout`, expired transactions)
   - p50/p95/p99 `durationMs` per route where present (match Phase 168 forensics style)
3. Decide **eligibility** (no guessing; record decision in the matrix):
   - webhooks + cron routes: eligible for dispatch-only/durable offload
   - user-facing read routes (`/api/inbox/*`): **not** eligible (keep synchronous; treat as verification targets)
4. Produce `docs/planning/phase-169/artifacts/log-driven-matrix.md` with these columns:
   - Route
   - Failure counts (500/504/blank status)
   - Dominant error signatures
   - Workflow criticality (P0/P1)
   - Offload mechanism (existing queue vs new Inngest dispatch-only vs keep sync)
   - Proposed event name (if Inngest)
   - Deterministic idempotency key (event id / dispatchKey / dedupeKey)
   - Concurrency cap (limit + key)
   - Rollback flag(s)
   - Owner files (exact paths)
   - Cross-phase dependency notes (Phase 53/165/167/168)
5. Lock the initial iteration order (P0 then P1) based on the matrix:
   - P0 must include the biggest contention/timeouts that amplify everything else (webhook + background jobs + response timing)
   - P1 includes remaining cron routes that still show 500/504 spikes after P0 is remediated

## Expected Output
- `docs/planning/phase-169/artifacts/log-driven-matrix.md` (decision register + migration matrix)
- A prioritized “Iteration Order” list (P0/P1) derived from the export

## Output
- Added `docs/planning/phase-169/artifacts/log-driven-matrix.md` with:
  - normalized route/status buckets (500/504/blank/200) for all targeted webhook/cron/sync routes
  - dominant signature evidence and `durationMs` p50/p95/p99 per target route (`durationMs > 0`)
  - decision-complete migration matrix (offload mechanism, event names, idempotency keys, concurrency caps, rollback flags, owner files, cross-phase dependencies)
  - locked P0/P1 iteration order
- Confirmed repo reality for all planned touchpoints:
  - candidate routes in this subphase all exist on disk
  - existing flags already present for webhook/background offload (`INBOXXIA_EMAIL_SENT_ASYNC`, `BACKGROUND_JOBS_USE_INNGEST`, `INNGEST_EVENT_KEY`)
  - no schema change required for this subphase artifact work
- Coordination notes:
  - Phase 165 overlap on `app/api/cron/background-jobs/route.ts` and `lib/background-jobs/*` captured in matrix dependency notes
  - Phase 168 forensics artifact reused as baseline style/evidence source

## Expected Handoff
Use the matrix to finalize event contracts, flags, idempotency, and concurrency caps in Phase 169b.

## Handoff
- Treat `docs/planning/phase-169/artifacts/log-driven-matrix.md` as the decision register for Phase 169b; do not reopen migration eligibility decisions unless new exports contradict the current dataset.
- In Phase 169b, lock event contracts and idempotency directly from the matrix rows and carry forward the same rollback flags/concurrency caps.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Parsed and normalized `zrg-dashboard-log-export-2026-02-17T21-43-29.json` route buckets by stripping host prefixes from `requestPath`.
  - Extracted per-route 500/504/blank counts, signature categories, and latency percentiles.
  - Verified route/flag touchpoints in repo code and authored the decision-complete migration matrix artifact.
- Commands run:
  - `jq '.[0] | keys' zrg-dashboard-log-export-2026-02-17T21-43-29.json` — pass (validated export schema fields).
  - `node` aggregation scripts over `zrg-dashboard-log-export-2026-02-17T21-43-29.json` — pass (produced normalized buckets, signatures, and p50/p95/p99 values).
  - `for f in ...; do test -f \"$f\"; done` for candidate routes + `vercel.json` — pass (all expected files exist).
  - `rg -n \"INBOXXIA_EMAIL_SENT_ASYNC|BACKGROUND_JOBS_USE_INNGEST|INNGEST_EVENT_KEY|CRON_SECRET\" ...` — pass (confirmed existing auth/flag anchors).
- Blockers:
  - None for subphase 169a.
- Next concrete steps:
  - Execute 169b by writing `docs/planning/phase-169/artifacts/inngest-offload-spec.md` with final event contracts, idempotency derivations, and per-route rollback/flag policy.
