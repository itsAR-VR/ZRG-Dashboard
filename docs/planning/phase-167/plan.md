# Phase 167 — Production Timeout Failure Triage + 800s Hardening (Multi-Path)

## Purpose
Resolve recurring timeout failures observed in recent production log exports by tracing the active timeout source and hardening the relevant runtime paths toward an 800-second ceiling where supported.

## Context
The user reported new errors in `zrg-dashboard-log-export-2026-02-17T18-12-24.json` and requested longer timeout headroom (`800s`) to reduce failure risk. Repo-grounded triage from this export shows the dominant timeout/error paths are not a single Inngest surface:

- `zrg-dashboard.vercel.app/api/inbox/conversations`: highest-volume failures with repeated runtime timeout signatures (`Task timed out after 300 seconds`).
- `zrg-dashboard.vercel.app/api/webhooks/email`: repeated runtime timeout signatures (`Task timed out after 60 seconds`).
- `zrg-dashboard-43ii28irb-zrg.vercel.app/api/cron/response-timing`: repeated `500` with Prisma `P2028` expired transaction errors around `5000ms`.

Inngest remains adjacent because Phase 165 moved background orchestration, but this phase must harden timeout behavior by failure class (runtime timeout vs transaction timeout), not by assumption.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 166 | Recent | Adjacent AI/cron runtime paths | Keep edits scoped to timeout/error handling only; avoid booking logic changes |
| Phase 165 | Recent | Inngest orchestration + cron dispatch | Align with Phase 165 dispatch assumptions; preserve idempotency/dispatch contracts |
| Phase 164 | Recent | Inbox timeout/perf hardening (`actions/lead-actions.ts`, `app/api/inbox/*`) | Re-read current inbox route/action files before edits and merge semantically |
| Phase 161 | Recent | Inbox incident triage + observability expectations | Preserve incident attribution and read-path auth/flag behavior |
| Working tree | Active | Uncommitted changes in inbox/webhook/cron files | Do not revert; coordinate and merge only targeted timeout changes |

## Repo Reality Check (RED TEAM)

- What exists today:
  - `app/api/webhooks/email/route.ts` already exports `maxDuration = 800`.
  - `app/api/inbox/conversations/route.ts` already exports `maxDuration = 800`.
  - `app/api/cron/response-timing/route.ts` already exports `maxDuration = 800`.
  - `app/api/cron/background-jobs/route.ts` exports `maxDuration = 800` and has Inngest enqueue + inline fallback modes.
  - `lib/response-timing/processor.ts` still has a separate internal transaction timeout envelope that can fail before Vercel route max duration.
- What the plan assumes:
  - Timeout failures are multi-path and must be mitigated per path-specific root cause.
  - `maxDuration` alone is insufficient where internal DB transaction limits or expensive synchronous work dominate.
- Verified touch points:
  - `app/api/webhooks/email/route.ts`
  - `app/api/inbox/conversations/route.ts`
  - `app/api/inbox/counts/route.ts`
  - `app/api/cron/response-timing/route.ts`
  - `lib/response-timing/processor.ts`
  - `app/api/cron/background-jobs/route.ts`
  - `lib/inngest/client.ts`
  - `lib/inngest/functions/process-background-jobs.ts`
  - `lib/inngest/functions/background-maintenance.ts`

## Objectives
* [x] Identify exact timeout/error signatures and classify by failure class (runtime timeout, DB transaction timeout, external stall).
* [x] Verify supported timeout controls and hard limits in current docs (Vercel + Inngest) and map each control to the correct path.
* [x] Apply minimal changes for each failing path to reduce timeouts while preserving behavior.
* [x] Keep 800-second configuration where supported and already required, but avoid no-op edits where `maxDuration = 800` is already present.
* [x] Validate locally and with available Vercel/Inngest diagnostics evidence.

## Constraints
- Keep changes surgical and limited to timeout/error-resolution scope.
- Preserve existing Inngest job semantics, cron auth, and idempotency behavior.
- Preserve inbox read-path auth/feature-flag semantics.
- Preserve webhook ingestion correctness, de-dupe behavior, and background enqueue semantics.
- Use current platform documentation before changing runtime timeout knobs.
- Do not introduce speculative refactors outside this failure path.

## Success Criteria
- Log forensics pinpoints concrete failing endpoint/function and timeout source(s) with per-path attribution.
- Runtime timeout signatures materially improve in post-change evidence windows:
  - no new `Task timed out after 60 seconds` on `/api/webhooks/email` in sampled logs,
  - no recurring `Task timed out after 300 seconds` burst pattern on `/api/inbox/conversations` in sampled logs,
  - no new Prisma `P2028` expired-transaction failures on `/api/cron/response-timing` in sampled logs.
- If any path still cannot reach requested behavior due to platform/runtime caps, plan records cap + fallback mitigation.
- Prior Inngest and inbox phase assumptions remain intact (no regressions in dispatch/auth/flags).
- Required quality gates run and outcomes are recorded:
  - `npm run lint`
  - `npm run build`
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-167/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-167/replay-case-manifest.json --concurrency 3`
  - optional baseline compare when prior artifacts exist:
    - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-167/replay-case-manifest.json --baseline .artifacts/ai-replay/<prior-run>.json`
  - fallback when no manifest is available yet:
    - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
    - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
- Phase artifacts include a concise evidence summary and any unresolved platform constraints.
- Replay artifact review captures `judgePromptKey`, `judgeSystemPrompt`, and per-case `failureType`.

## Success Criteria Status (Current)
- Met:
  - Failure-class triage and per-path attribution completed.
  - Timeout contract mapping + surgical patch set completed.
  - `lint`, `build`, and `test:ai-drafts` passed (latest rerun included in closeout).
  - Replay dry-run + prior live diagnostics are captured in phase artifacts; no further replay was run this turn per user directive.
  - Vercel env rollout completed for Preview + Production:
    - `INBOXXIA_EMAIL_SENT_ASYNC=true`
    - `AVAILABILITY_CRON_TIME_BUDGET_MS=600000`
    - `RESPONSE_TIMING_MAX_MS=120000`
    - `RESPONSE_TIMING_BATCH_SIZE=200`
    - `RESPONSE_TIMING_LOOKBACK_DAYS=90`
  - Deployments completed:
    - Preview: `https://zrg-dashboard-66u1s7678-zrg.vercel.app`
    - Production: `https://zrg-dashboard-erlbci5s5-zrg.vercel.app` (aliased to `https://zrg-dashboard.vercel.app`)
  - Post-deploy verification captured:
    - Cron smoke checks returned `200` on `/api/cron/followups` and `/api/cron/availability` (locked-path responses expected).
    - Runtime log sampling window showed active webhook traffic on `/api/webhooks/email` without observed `Task timed out`, `P2028`, or `query_wait_timeout` entries during capture.
- Monitoring follow-up (not a blocker):
  - Continue log sampling over the next production traffic window for sustained confirmation on timeout signatures across inbox and response-timing endpoints.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- False-positive Inngest focus while dominant errors occur on webhook/inbox/cron paths outside Inngest invocation.
- Believing `maxDuration=800` alone solves timeouts when internals still expire first (DB transaction timeout in response timing).
- Cross-phase merge regressions in actively edited files (`actions/lead-actions.ts`, inbox routes, webhook route, response-timing processor).

### Missing or ambiguous requirements
- Original plan did not define per-path acceptance thresholds; success criteria are now explicit by signature and endpoint.
- Original plan lacked a concrete conflict-resolution strategy for active uncommitted edits in overlapping files.

### Repo mismatches (fix the plan)
- Plan assumption corrected: the incident is multi-path timeout hardening, not primarily Inngest timeout tuning.
- Verified that major endpoints already declare `maxDuration = 800`; hardening must target runtime/query behavior where relevant.

### Performance / timeouts
- `/api/webhooks/email` has synchronous work that can exceed 60s in production bursts despite route-level max duration.
- `/api/inbox/conversations` still exhibits long-running read path behavior under heavy search workloads.
- `/api/cron/response-timing` failures come from transaction expiration near 5s and need transaction-scope tuning/work reduction.

### Security / permissions
- Maintain existing `Authorization: Bearer <CRON_SECRET>` checks on cron routes.
- Do not weaken inbox/webhook auth or feature-flag gate behavior while changing timeout handling.

### Testing / validation
- Required NTTAN validation gates were broadened to manifest-first replay commands with fallback.
- Validation now requires explicit post-change log signature checks, not only local test success.

## Multi-Agent Coordination Notes

- Last 10 phases (`157`–`166`) were scanned for overlap; timeout-relevant domains overlap with Phases `161`, `164`, and `165`.
- Current working tree includes uncommitted changes touching planned timeout files:
  - `actions/lead-actions.ts`
  - `app/api/inbox/conversations/route.ts`
  - `app/api/inbox/counts/route.ts`
  - `app/api/webhooks/email/route.ts`
  - `lib/response-timing/processor.ts`
- Conflict strategy:
  - Re-read current file state immediately before each edit.
  - Merge semantically on top of concurrent changes.
  - Document conflict resolution in subphase outputs.

## Subphase Index
* a — Error Signature Triage (Logs + Prior Phase Correlation)
* b — Timeout Contract Verification (Context7 + Platform Limits)
* c — Surgical Timeout Patch (Inngest/Vercel Runtime Path)
* d — Validation + Evidence + Rollout Notes
* e — Evidence Re-baseline + Failure-Class Attribution Matrix
* f — Timeout Contract Verification (Vercel + Inngest + Prisma Runtime Semantics)
* g — Surgical Multi-Path Patch Plan (Webhook + Inbox + Response-Timing)
* h — Validation, Replay Diagnostics, Rollout + Rollback Evidence

## Assumptions (Agent)

- Multi-path hardening is the intended scope for this phase (confidence ~95%).
  - Mitigation check: if scope must be reduced, cut Phase 167 to webhook-only and split inbox/cron into a follow-up phase.
- Inngest is a secondary verification path for this incident packet, not the dominant timeout source (confidence ~92%).
  - Mitigation check: if new logs show Inngest invocation timeout dominance, reprioritize subphase `g` patch sequence.

## Open Questions (Need Human Input)

- [x] Deploy scope decision resolved (2026-02-17): preview first, then production.
- [x] `INBOXXIA_EMAIL_SENT_ASYNC` rollout decision resolved (2026-02-17): enabled in Preview + Production.
- [x] Validation scope decision resolved (2026-02-17): no additional NTTAN replay required for this closeout turn (user-directed).

## Phase Summary (running)

- 2026-02-17 — RED TEAM refinement updated Phase 167 scope to multi-path timeout hardening based on export evidence (`/api/webhooks/email`, `/api/inbox/conversations`, `/api/cron/response-timing`), appended executable subphases `e-h`, and added mandatory replay artifact diagnostics.
- 2026-02-17 19:31Z — Implemented timeout hardening patch set across webhook/inbox/cron + Prisma interactive transaction envelopes (files: `app/api/webhooks/email/route.ts`, `app/api/cron/availability/route.ts`, `app/api/cron/emailbison/availability-slot/route.ts`, `app/api/inbox/conversations/route.ts`, `app/api/inbox/counts/route.ts`, `actions/lead-actions.ts`, `lib/response-timing/processor.ts`).
- 2026-02-17 19:31Z — Validation pass: `lint`, `build`, `test:ai-drafts`, replay dry-run (manifest) passed; full 20-case live replay with manifest + concurrency 3 hit DB `query_wait_timeout` instability; 1-case live replay fallback passed with judge diagnostics artifact.
- 2026-02-17 19:31Z — Vercel diagnostics pass: production deployments listed and env inventory retrieved; `INBOXXIA_EMAIL_SENT_ASYNC` not present in current production env listing.
- 2026-02-17 21:37Z — Applied Vercel env updates to Preview + Production: `INBOXXIA_EMAIL_SENT_ASYNC=true`, `AVAILABILITY_CRON_TIME_BUDGET_MS=600000`, `RESPONSE_TIMING_MAX_MS=120000`, `RESPONSE_TIMING_BATCH_SIZE=200`, `RESPONSE_TIMING_LOOKBACK_DAYS=90`.
- 2026-02-17 21:41Z — Completed Preview + Production deployment rollout: preview `https://zrg-dashboard-66u1s7678-zrg.vercel.app` and production `https://zrg-dashboard-erlbci5s5-zrg.vercel.app` (aliased to `https://zrg-dashboard.vercel.app`).
- 2026-02-17 21:46Z — Post-deploy smoke/log checks: `/api/cron/followups` and `/api/cron/availability` returned 200 locked-skip responses; runtime sampling showed active `/api/webhooks/email` traffic with no observed `Task timed out`, `P2028`, or `query_wait_timeout` signatures during the sampled window.
