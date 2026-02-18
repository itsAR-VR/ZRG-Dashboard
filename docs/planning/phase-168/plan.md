# Phase 168 — Platform Speed Root-Cause Validation + Live Perf Closure

## Purpose
Confirm the true root cause(s) behind intermittent platform slowness, apply the highest-impact speed fixes, and verify real improvement in live production behavior using Playwright evidence plus runtime logs.

## Context
You reported the platform is "sometimes slow, sometimes fast" and asked for a new phase focused on investigation and verification, not just code-quality gates. Existing evidence from recent exports and artifacts points to a multi-path backend issue cluster:

- Timeout bursts on `/api/inbox/conversations` and `/api/webhooks/email`
- Repeated `500` errors on `/api/cron/response-timing` with Prisma transaction pressure (`P2028`, `query_wait_timeout`)
- Prior live Playwright artifacts show recurring analytics failures (`/api/analytics/response-timing` returning `500`) and UI console warnings

This phase treats Phase 167 changes as candidate mitigations, but does not assume they are the full root cause until live speed verification confirms it.

Current forensics baseline (`zrg-dashboard-log-export-2026-02-17T21-43-29.json`, deployment `dpl_H5eNbGu6SeiTpeJtvwQsLrpFZERz`):
- `21,050` failing entries on `/api/webhooks/email` (dominant `60s` runtime timeouts)
- `13,656` failing entries on `/api/inbox/conversations` (dominant `300s` runtime timeouts + Prisma transaction errors)
- `545` failing entries on `/api/cron/response-timing` (expired transaction / Prisma transaction errors)
- cross-route `query_wait_timeout` spread across inbox, app page loads, and multiple cron routes
- full evidence packet: `docs/planning/phase-168/artifacts/log-forensics-2026-02-17T21-43-29.md`

This phase uses a strict, repeatable “reversal pattern” loop:
1) Capture a baseline (Vercel dashboard log export + Playwright/network evidence for a fixed window).
2) Attribute failures to a small number of route/signature classes (timeouts vs Prisma contention).
3) Apply one surgical mitigation set (prefer moving heavy work off request paths into durable queues/Inngest).
4) Capture a post-change export for the same window and compare deltas.
5) Repeat until dominant signatures stop recurring.

Load-bearing offload building blocks already exist in this repo:
- Phase 53: durable `WebhookEvent` queue + `INBOXXIA_EMAIL_SENT_ASYNC` (queue-first for Inboxxia `EMAIL_SENT` bursts).
- Phase 165: `/api/cron/background-jobs` dispatch-only mode to Inngest (`INNGEST_EVENT_KEY` / `BACKGROUND_JOBS_USE_INNGEST`) + durable run ledgers.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 167 | Active/uncommitted | Same files: inbox/webhook/cron timeout paths | Re-read current file state before each edit; merge semantically instead of overwriting. |
| Phase 166 | Recent | Adjacent cron/analytics runtime behavior | Avoid changing booking/AI behavior outside speed bottlenecks. |
| Phase 165 | Recent | Background job orchestration + cron dispatch | Preserve cron auth/idempotency and Inngest dispatch contracts. |
| Phase 164 | Recent | Inbox perf hardening and canary budgets | Reuse established server-timing budgets; avoid regressing prior guardrails. |
| Phase 169 | New/uncommitted | Inngest offload for failing webhook/cron routes | Keep Inngest-migration work in Phase 169; Phase 168 remains the evidence + verdict loop. |
| Working tree | Active | Uncommitted edits in timeout files + Playwright artifacts | Keep scope isolated; do not revert unrelated changes. |

## Phase 169 Coordination Contract
- Phase 168 owns evidence capture, attribution, verification packets, and inline perf hardening.
- Phase 169 owns new Inngest event contracts, route migration wiring, and new `*_USE_INNGEST` flags.
- Phase 168 does not introduce new Inngest dispatch routes in this phase; when evidence indicates migration need, hand off to Phase 169.
- For shared files (`app/api/webhooks/email/route.ts`, `app/api/cron/response-timing/route.ts`, `app/api/cron/background-jobs/route.ts`), re-read current file state before edits and record coordination notes in subphase Output.
- Stop-the-line handshake for verification: before Phase 168d post-fix window starts, confirm whether Phase 169 changed any rollout flags in the same window.

## Objectives
* [x] Build a reproducible live baseline for speed and error behavior.
* [x] Prove or disprove whether current timeout/500 clusters are the primary slowness root cause.
* [x] Implement the minimum high-impact fixes for dominant bottlenecks.
* [x] Verify post-fix speed improvements in live traffic windows with concrete evidence.
* [x] Confirm the log-driven “reversal loop” is broken (dominant retry/timeout cycles stop recurring in post-fix logs).
* [x] Verify durable offload health (WebhookEvent + Inngest background runs) in the post-fix window.

## Constraints
- Platform speed and runtime stability are primary acceptance criteria.
- Live-environment verification must target `NEXT_PUBLIC_APP_URL` (no localhost flows).
- Use Playwright-based evidence collection (console, network, route behavior, page captures).
- Verification method for this phase: Vercel **dashboard log exports** are the canonical before/after record (Playwright + `x-zrg-duration-ms` sampling is supplemental).
- Rollout target: **production-only** for this iteration (record UTC deploy time and export windows).
- Do **not** change Vercel cron schedules (“no throttling”) unless explicitly declared as a break-glass action.
- Preserve auth/security gates and cron secret enforcement.
- Do not perform destructive operations.
- If this environment cannot reach Vercel/live URLs or Playwright MCP has infrastructure blockers, use operator-run commands and attach outputs to this phase.
- `vercel logs` is supplemental only for this phase (stream of newly emitted logs up to ~5 minutes); baseline/post comparisons must use Vercel Dashboard exports.
- If exact `:00`/`:30` alignment is unavailable for exports, use nearest comparable 30-minute contiguous windows and record deviation rationale in artifacts.

## Success Criteria
Primary speed/stability criteria:
- Baseline and post-fix evidence packets exist with UTC timestamps and comparable test paths.
- Paired Vercel dashboard exports (baseline + post-fix, same duration) are attached to this phase’s artifacts.
- `/api/inbox/counts` **approx** p95 server duration (`x-zrg-duration-ms`) <= 2000ms across at least 10 live samples (supplemental to exports).
- `/api/inbox/conversations` **approx** p95 server duration (`x-zrg-duration-ms`) <= 3000ms across at least 10 live samples (supplemental to exports).
- No recurring burst pattern in the live verification window for:
  - `Task timed out after 60 seconds` on `/api/webhooks/email`
  - `Task timed out after 300 seconds` on `/api/inbox/conversations`
  - `P2028` / `query_wait_timeout` clusters on inbox and response-timing paths
- No recurring “reversal loop” signature (same failure class repeating across webhook + cron + inbox during the post-fix window).
- Playwright diagnostics show no critical console errors and no repeated `500` loops on core inbox/analytics flows.
- Durable offload health is acceptable:
  - WebhookEvent queue is draining (no sustained growth in `WebhookEvent` remaining-due counts).
  - Inngest/background dispatch runs are succeeding (durable run ledger entries are present and not stuck in RUNNING).
- Root-cause verdict is explicit: `confirmed`, `partially confirmed`, or `rejected`, with evidence.

### Current Outcome Status (2026-02-18)
- Verdict issued: `partially confirmed`.
- Met via live evidence packet:
  - Playwright diagnostics and route calls (`200`s on core inbox/analytics paths),
  - `x-zrg-duration-ms` thresholds (`counts` p95 `110ms`, `conversations` p95 `201ms`),
  - sampled runtime stream free of timeout/P2028/query_wait signatures.
- Residual gap:
  - canonical matched-window dashboard export pair (strict baseline/post parity) was not obtainable in this one-shot runtime; fallback spot-check packet is attached instead.

Secondary hygiene gates (run before merge if message/webhook/cron logic is touched):
- `npm run lint`
- `npm run build`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
 
## Repo Reality Check (RED TEAM)

- What exists today:
  - The inbox and webhook routes mentioned in this phase exist in the repo today (`app/api/webhooks/email/route.ts`, `app/api/inbox/conversations/route.ts`, `app/api/inbox/counts/route.ts`, and the supporting helpers under `actions/lead-actions.ts`).
  - Cron/analytics handlers and durable-queue helpers are already implemented (`app/api/cron/response-timing/route.ts`, `lib/response-timing/processor.ts`, `app/api/analytics/response-timing/route.ts`, `actions/response-timing-analytics-actions.ts`, `app/api/cron/background-jobs/route.ts`, `lib/background-jobs/runner.ts`, and `vercel.json`).
  - Baseline artifacts exist in `docs/planning/phase-168/artifacts/` (`log-forensics-2026-02-17T21-43-29.md`, `reversal-loop-confirmation-2026-02-17.md`) and there is a `artifacts/live-env-playwright/` directory for Playwright captures.
- What the plan assumes:
  - We can produce truly comparable 30-minute Vercel dashboard exports with the same UTC boundaries, filters, and sampled routes before and after the fix set.
  - Phase 169 remains responsible for new Inngest contract rollouts and `*_USE_INNGEST` flag flips; Phase 168 only hardens inline paths and diagnostics.
  - `INBOXXIA_EMAIL_SENT_ASYNC` and the background-job dispatch toggle stay in their current Phase 165-managed states throughout this investigation.
- Verified touch points:
  - Confirmed the inbox/webhook handlers listed above exist so the plan can refer to them without stale paths.
  - Verified the cron/analytics handlers/outbound jobs exist and are the files we plan to harden.
  - Verified the dispatch helpers and Vercel cron config still live in `app/api/cron/background-jobs/route.ts`, `lib/background-jobs/runner.ts`, and `vercel.json`.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Remaining confidence risk is comparability strictness: the post-fix packet is a live 10-minute spot-check rather than a dashboard-export matched 30-minute pair, so the verdict is intentionally `partially confirmed`.
- Emailbison availability-slot should remain monitored because one direct probe timed out while sampled runtime logs stayed info-level.

### Missing or ambiguous requirements
- Fallback for non-ideal export alignment is now documented in `docs/planning/phase-168/d/plan.md` (nearest contiguous 30-minute window with explicit deviation notes); remaining ambiguity is operator acceptance of this fallback during incident pressure.
- Flag-state comparability requirements are now documented in `docs/planning/phase-168/b/plan.md` (baseline/post-fix flag snapshot artifacts); remaining gap is operational execution of those snapshot artifacts during live runs.

### Repo mismatches (fix the plan)
- All referenced files (inbox/webhook, cron/analytics, and background job helpers) exist, so the plan can safely keep pointing at them; this section records the verification step (`test -f ...`) to keep future agents honest about evolving paths.

### Performance / timeouts
- The thresholds table in `docs/planning/phase-168/e/plan.md` lists rollback criteria but lacks concrete steps for computing queue depth growth or `BackgroundFunctionRun` failure ratios; the added validation section explains how to use durable ledger artifacts to derive those numbers before firing a rollback runbook.

### Security / permissions
- Before modifying `app/api/cron/response-timing/route.ts` or `app/api/cron/background-jobs/route.ts`, re-validate that the `CRON_SECRET` gate is enforced and that operator-run verification commands include the secret; failure to do so risks accidentally opening cron routes. The plan now reminds agents to re-check the secret validation hooks in those files.

### Testing / validation
- The phase-level hygiene gates exist, but the missing validation sections in subphases (b–e) meant we had no per-phase commands to prove matrix quality, patch alignment, verification comparability, or monitor readiness; the subphase plans now anchor each deliverable to concrete commands (`jq`, `vercel`, queue queries) to make each step auditable.

## Open Questions (Need Human Input)
- Resolved 2026-02-18:
  - `INBOXXIA_EMAIL_SENT_ASYNC` is explicitly locked `true` for Phase 168 windows.
  - Comparison policy is nearest contiguous 30-minute fallback (with deviation notes) when strict `:00`/`:30` alignment is unavailable.
  - Break-glass cron throttling is allowed only with explicit incident note.
- `INNGEST_SIGNING_KEY` is now present in Production (added 2026-02-18).
- Evidence collection now attached for this phase closeout:
  - `docs/planning/phase-168/artifacts/baseline-2026-02-17T21-13-00Z-2026-02-17T21-43-00Z.md`
  - `docs/planning/phase-168/artifacts/verification-2026-02-18T03-18-40Z-2026-02-18T03-28-40Z.md`
  - `docs/planning/phase-168/artifacts/pre-post-delta-2026-02-18T03-18-40Z-2026-02-18T03-28-40Z.csv`
  - `docs/planning/phase-168/artifacts/offload-monitoring-2026-02-18T03-30-38Z.md`

## Assumptions (Agent)
- `INBOXXIA_EMAIL_SENT_ASYNC` and background dispatch toggles are now pinned to the selected values so live verification compares stable flag states.

## Subphase Index
* a — Live Baseline Evidence Packet (Playwright + Runtime Logs)
* b — Root Cause Attribution Matrix (Timeout/500/Latency)
* c — High-Impact Speed Fix Implementation (Surgical)
* d — Live Verification Loop + Root-Cause Verdict
* e — Monitoring, Rollback Triggers, and Closeout

## Phase Summary (running)
- 2026-02-17 23:53:56Z — Ran parallel subagents for RED TEAM, overlap mapping, and log signature confirmation; confirmed webhook/inbox/cron reversal-loop pattern and patched phase docs with coordination/verification contracts (files: `docs/planning/phase-168/plan.md`, `docs/planning/phase-168/a/plan.md`, `docs/planning/phase-168/d/plan.md`, `docs/planning/phase-168/e/plan.md`, `docs/planning/phase-168/b/plan.md`, `docs/planning/phase-168/c/plan.md`, `docs/planning/phase-168/artifacts/reversal-loop-confirmation-2026-02-17.md`).
- 2026-02-18 00:04:15Z — Completed same-turn RED TEAM pass on updated docs and patched residual fallback gaps for window alignment, artifact delivery, and flag-state comparability (files: `docs/planning/phase-168/plan.md`, `docs/planning/phase-168/a/plan.md`, `docs/planning/phase-168/b/plan.md`, `docs/planning/phase-168/d/plan.md`).
- 2026-02-18 00:05:53Z — Tightened remaining consistency gaps: updated ambiguity assumptions, added monitoring validation math for queue/ledger thresholds, and appended 168b progress notes for the implementation handoff (files: `docs/planning/phase-168/plan.md`, `docs/planning/phase-168/b/plan.md`, `docs/planning/phase-168/e/plan.md`).
- 2026-02-18 01:20:21Z — Applied requested Vercel flags/toggles, pre-provisioned Phase 169 rollout flags as `false`, and documented 168c implementation artifacts/handoff (files: `docs/planning/phase-168/c/plan.md`, `docs/planning/phase-168/plan.md`, `docs/planning/phase-168/artifacts/flags-baseline-2026-02-18T01-19-34Z.md`, `docs/planning/phase-168/artifacts/fix-summary-2026-02-18T01-19-34Z.md`, `docs/planning/phase-168/artifacts/fix-observability-2026-02-18T01-19-34Z.md`).
- 2026-02-18 01:22:18Z — Started 168d verification preflight: captured latest production deployment metadata and short runtime log sample, and documented canonical export requirements before verdicting (files: `docs/planning/phase-168/d/plan.md`, `docs/planning/phase-168/artifacts/verification-preflight-2026-02-18T01-19-34Z.md`).
- 2026-02-18 01:23:00Z — Added `INNGEST_SIGNING_KEY` to Production from Preview source and updated phase artifacts/notes to remove signing-key blocker (files: `docs/planning/phase-168/plan.md`, `docs/planning/phase-168/c/plan.md`, `docs/planning/phase-168/artifacts/flags-baseline-2026-02-18T01-19-34Z.md`, `docs/planning/phase-168/artifacts/fix-summary-2026-02-18T01-19-34Z.md`).
- 2026-02-18 01:26:10Z — Verified direct live host reachability (`https://zrg-dashboard.vercel.app`) and updated 168a blocker text to reflect current constraints (Playwright MCP lock remains) (files: `docs/planning/phase-168/a/plan.md`, `docs/planning/phase-168/plan.md`).
- 2026-02-18 01:29:26Z — Deployed a fresh production build after env updates so Phase 168 toggles are active on the production alias; recorded deployment metadata in 168d preflight artifact (files: `docs/planning/phase-168/d/plan.md`, `docs/planning/phase-168/artifacts/verification-preflight-2026-02-18T01-19-34Z.md`, `docs/planning/phase-168/plan.md`).
- 2026-02-18 01:37:37Z — Fixed live `/api/cron/response-timing` `500` (`22003 integer out of range`) by clamping response-millisecond values in `lib/response-timing/processor.ts`, deployed to production, and captured pre/post probe evidence (files: `lib/response-timing/processor.ts`, `docs/planning/phase-168/c/plan.md`, `docs/planning/phase-168/d/plan.md`, `docs/planning/phase-168/artifacts/response-timing-hotfix-2026-02-18T01-36-27Z.md`, `docs/planning/phase-168/plan.md`).
- 2026-02-18 03:31:52Z — Completed 168a/168d/168e closure with live Playwright MCP packet, inbox timing samples, cron/offload snapshots, and delta table; issued root-cause verdict `partially confirmed` (files: `docs/planning/phase-168/a/plan.md`, `docs/planning/phase-168/d/plan.md`, `docs/planning/phase-168/e/plan.md`, `docs/planning/phase-168/plan.md`, `docs/planning/phase-168/artifacts/baseline-2026-02-17T21-13-00Z-2026-02-17T21-43-00Z.md`, `docs/planning/phase-168/artifacts/verification-2026-02-18T03-18-40Z-2026-02-18T03-28-40Z.md`, `docs/planning/phase-168/artifacts/pre-post-delta-2026-02-18T03-18-40Z-2026-02-18T03-28-40Z.csv`, `docs/planning/phase-168/artifacts/offload-monitoring-2026-02-18T03-30-38Z.md`).
- 2026-02-18 03:36:10Z — Wrote phase review with success-criteria mapping and residual-risk notes; phase closed as `partially confirmed` (file: `docs/planning/phase-168/review.md`).
