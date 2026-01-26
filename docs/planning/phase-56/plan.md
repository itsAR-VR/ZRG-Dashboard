# Phase 56 — Ship Readiness: Rollout + Verification (Phases 46–55)

## Purpose
Close out the remaining rollout + production verification tasks from Phases **46–55**, with priority on:
1) Phase 53 production stability rollout (schema + flags + monitoring), and
2) Phase 55 EmailBison first-touch `availability_slot` cron verification and safe enablement.

## Context
The last ten phases (46–55) shipped a large batch of reliability + AI + booking automation work, and the “what’s next” is mostly **production verification and rollout** (plus a few missing unit tests).

### Recap (last 10 phases)
- **Phase 46:** Fixed FC “double set” root cause by healing outbound EmailBison sync duplicates; improved setter draft regeneration booking-context fidelity; added a dedupe script + FC runbook.
- **Phase 47:** Shipped prompt/snippet overrides UI + AI auto-send delay; correctness gaps were identified and follow-ups were completed in-tree (cache reset, booking-stage template persistence, snippet registry alignment, registry-based draft prompts, immediate-send cancellation check).
- **Phase 48:** Consolidated auto-send logic into `lib/auto-send/*` orchestrator with strong unit coverage; manual smoke tests still needed for real providers.
- **Phase 49:** Added email draft “step 3” verification + deterministic sanitization (em-dash removal, canonical booking link enforcement) with unit tests.
- **Phase 50:** Added email participant headers + CC editor; persisted participant metadata from webhooks; enforced CC sanitization server-side and added tests.
- **Phase 51:** Introduced inbound post-process kernel + adapters (SmartLead/Instantly), unified email send helper, and a unified prompt runner migrating 15+ call sites; still needs real-world smoke tests and a few targeted tests.
- **Phase 52:** Implemented booking process primitives and a full Notification Center (Slack/Resend) including schema + settings UI; follow-on automation (scheduler-link booking) is explicitly deferred.
- **Phase 53:** Shipped production stability work: webhook burst queueing, inbox counts perf, auth noise reduction, AI verifier resilience, and integration health gating; **requires schema rollout + flag enablement plan in production**.
- **Phase 54:** Reactivation anchor discovery (tiered selection + GHL-assisted fallback) with unit tests; needs production monitoring.
- **Phase 55:** Implemented EmailBison first-touch `availability_slot` JIT injection via Vercel cron + persisted offered slots; needs production dry-run + end-to-end verification.

## Multi-Agent / Repo Reality Check
- Last 10 phases by mtime: `phase-57, 56, 52, 54, 55, 53, 51, 50, 49, 48`
- `git status --porcelain` currently shows: `?? docs/planning/phase-56/`, `?? docs/planning/phase-57/`, `?? logs_result.json` (log export; see Phase 57)

## Repo Reality Check (RED TEAM)

- Verified touch points exist:
  - Phase 53 rollout: `docs/planning/phase-53/runbook.md`, `scripts/phase-53-ship-check.ts`, `scripts/backfill-lead-message-rollups.ts`
  - Phase 55 cron: `app/api/cron/emailbison/availability-slot/route.ts`, `lib/emailbison-first-touch-availability.ts`, `vercel.json`
  - Auth flags/vars referenced are real: `INBOXXIA_EMAIL_SENT_ASYNC`, `UNIPILE_HEALTH_GATE`, `CRON_SECRET`
- Local quality gates (2026-01-25):
  - `npm run lint` ✅ (0 errors, 18 warnings)
  - `npm run typecheck` ✅
  - `npm test` ✅
  - `npm run build` ✅
- Gap audit write-up: `docs/planning/phase-56/gaps.md`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Phase 53 flag enablement without schema → `/api/webhooks/email` can 500 on EMAIL_SENT enqueue → mitigation: ship-check + staged flag rollout per runbook.
- Phase 55 provider PATCH fails after DB persistence → “offered slots that were never sent” → mitigation: monitor cron error ratio; follow-on code change to patch before persisting.
- Cron overlap (Phase 55) → double-patch/ledger increments under concurrency → mitigation: keep `maxDuration` low; add per-client lock if overlap observed.

### Testing / validation gaps
- `npm test` only covers auto-send orchestrator today; other unit tests exist but are not part of the default suite.
- Many shipped flows remain “code-level complete” but not verified end-to-end in production (Phase 46 FC, Phase 52 notifications, Phase 53 flags, Phase 55 cron).

## Open Questions (Need Human Input)

- [ ] Should we treat fixing `npm test` coverage (run all `*.test.ts`) as a ship-blocker for this release? (confidence ~70%)
  - Why it matters: CI confidence vs speed; determines whether test harness changes are included before rollout.
  - Current assumption in this plan: fix immediately after P0 rollouts if rollout is urgent.

## Objectives
* [ ] Roll out Phase 53 schema + backfill + flags safely in production.
* [ ] Validate and safely enable Phase 55 cron in production (dry run + single-lead E2E).
* [ ] Run and document manual smoke tests for the most failure-prone end-to-end flows.
* [ ] Fill the highest-risk missing unit tests (processor + pipeline ordering).

## Constraints
- **No secrets in repo**; any rollout steps must reference env vars and runbooks only.
- Treat all webhooks as untrusted input; do not add synchronous provider calls to webhook paths as part of rollout.
- Prefer safe/gradual rollout via feature flags and dry-run modes where available.

## Success Criteria
- Phase 53:
  - [ ] `npm run db:push` applied to the correct production database.
  - [ ] `node --import tsx scripts/phase-53-ship-check.ts --strict` passes.
  - [ ] Backfill run completes (`scripts/backfill-lead-message-rollups.ts`).
  - [ ] Deploy completes with `INBOXXIA_EMAIL_SENT_ASYNC=0` and `UNIPILE_HEALTH_GATE=0`, then flags are enabled gradually with monitoring.
- Phase 55:
  - [ ] Production `dryRun=true` returns sensible counters and `finishedWithinBudget=true`.
  - [ ] One lead verified end-to-end (EmailBison `availability_slot` set, `Lead.offeredSlots` persisted, ledger increments).
  - [ ] Downstream acceptance → auto-book path is confirmed to still work.
- Manual verification:
  - [ ] FC “double set” does not recur (Phase 46 runbook).
  - [ ] Auto-send immediate + delayed paths behave as expected (Phase 48/47 semantics).
  - [ ] SmartLead/Instantly inbound post-process still behaves correctly (Phase 51 kernel).
- Tests:
  - [ ] Add at least one unit test suite for `processEmailBisonFirstTouchAvailabilitySlots()` (Phase 55).
  - [ ] Add at least one unit test verifying inbound kernel stage ordering / invariants (Phase 51).

## Subphase Index
* a — Phase 53 production rollout (schema + flags)
* b — Phase 55 cron verification + enablement
* c — Manual smoke tests (critical flows)
* d — Fill the highest-risk missing unit tests
* e — Monitoring + cleanup (alerts, runbooks, log artifacts)
