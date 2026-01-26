# Phase 56 — Gap & Weak-Spot Audit (Phases 46–55)

**Audit date:** 2026-01-25

This is an adversarial review of what shipped in Phases 46–55, focusing on likely failure modes, rollout gaps, test gaps, and “paper cuts” that could become production incidents.

## Repo Health Snapshot (local)

### Git state
- `git status --porcelain`: `?? docs/planning/phase-56/`, `?? docs/planning/phase-57/`, `?? logs_result.json` (~992KB log export; 1000 records)

### Quality gates (executed 2026-01-25)
- `npm run lint`: ✅ pass (0 errors, **18 warnings**)
- `npm run typecheck`: ✅ pass
- `npm test`: ✅ pass (note: only runs `lib/auto-send/__tests__/orchestrator.test.ts`)
- `npm run build`: ✅ pass (with pre-existing Next warnings about lockfiles + middleware convention)

### Unit tests present vs executed
Present test files:
- `lib/auto-send/__tests__/orchestrator.test.ts`
- `lib/ai-drafts/__tests__/step3-verifier.test.ts`
- `lib/__tests__/reactivation-anchor.test.ts`
- `lib/__tests__/email-participants.test.ts`

Executed during audit:
- ✅ All 4 tests pass when run directly via `node --import tsx --test ...`
- ⚠️ Only **1/4** runs via `npm test` today (test harness limitation)

## High-Risk Gaps (most likely to bite in prod)

### 0) Active prod error flood exists (Phase 57)
`logs_result.json` indicates a current, high-volume cron error pattern:
- Time window: 2026-01-25 09:05:25–09:20:46 UTC
- Dominant signature (~919 occurrences): `[Appointment Upsert] Missing ghlAppointmentId for GHL appointment upsert` from `/api/cron/appointment-reconcile`

This is now the most urgent “bug” signal in the repo. See `docs/planning/phase-57/plan.md`.

### 1) Phase 53 rollout is still the biggest “unknown”
**What’s shipped:** Durable webhook queue + bounded runner, inbox counts rewrite, auth-noise fixes, AI verifier resilience, Unipile health gating.

**What’s missing/unknown:**
- Has the **Phase 53 schema** been applied to production? (WebhookEvent table + new Lead columns)
- Has the rollup backfill run in prod (Lead.lastZrgOutboundAt)?
- Are the flags enabled safely (`INBOXXIA_EMAIL_SENT_ASYNC`, `UNIPILE_HEALTH_GATE`) and monitored?

**Why it matters:** Enabling `INBOXXIA_EMAIL_SENT_ASYNC` without schema will cause `/api/webhooks/email` EMAIL_SENT events to 500. Not enabling it means the original burst risk remains.

### 2) Phase 55 cron is “code-complete” but needs prod verification
**What’s shipped:** `/api/cron/emailbison/availability-slot` injects `availability_slot` JIT and persists `Lead.offeredSlots`.

**What’s missing/unknown:**
- Production `dryRun=true` counters and error rate.
- Provider semantics: EmailBison `PATCH` behavior for `custom_variables` (merge vs replace-all) in your tenant.
- One lead E2E: confirm `availability_slot` is set, not clobbering other vars, and DB + ledger match.

### 3) Phase 46 FC “double set” fix needs real confirmation
**What’s shipped:** outbound sync “heal” logic to prevent duplicate outbound Message rows.

**What’s missing/unknown:** The FC manual runbook confirmation that:
- one provider send occurs per action, and
- the UI does not show a second outbound message after sync.

### 4) Phase 48/47 auto-send changes still need provider-level smoke tests
**What’s shipped:** auto-send orchestrator + delay scheduling + cancellation validation.

**What’s missing/unknown:** End-to-end confirmation in a real workspace that:
- “immediate send” path correctly cancels when conversation changes
- “delayed send” schedules, validates, and sends exactly once
- “low confidence” consistently triggers Slack review and does not send

### 5) Phase 52 Notification Center is mostly unverified end-to-end
**What’s shipped:** NotificationEvent/SendLog schema, Slack + Resend delivery, daily digests via `/api/cron/followups`.

**What’s missing/unknown:** Real integrations:
- Slack scopes + channel selection works in a real workspace
- Resend delivery works with per-workspace API keys
- Digest aggregation doesn’t spam (SendLog TTL/dedupe)

## Code-Level Bug Candidates / Weak Spots

### A) Phase 55: Offered slots can be persisted even if provider patch fails
In `lib/emailbison-first-touch-availability.ts`, the current order is:
1) compute slots + sentence
2) persist `Lead.offeredSlots` + increment ledger
3) patch EmailBison lead `custom_variables`

If the EmailBison PATCH fails (rate limit / network / provider), DB + ledger can say “we offered these slots” even though the outbound template never got the variable.

**Impact:**
- Downstream “acceptance of offered slot” logic may fire based on slots the lead never saw.
- Ledger counts may skew future slot selection despite no real offer being sent.

**Mitigation (ops):**
- Monitor `errors` / `leadsUpdated` ratio from the cron response.
- During rollout, verify PATCH success on a test lead before enabling broadly.

**Suggested fix (follow-on code change):**
- Patch provider first; only persist `offeredSlots` + increment ledger after patch succeeds (or write “pending” state and reconcile on success).

### B) Tests: `npm test` is misleadingly narrow
`npm test` currently runs only the auto-send orchestrator test file (`scripts/test-orchestrator.ts`).

**Impact:** regressions in step-3 verifier, reactivation anchor selection, email participants, etc. will not be caught by CI if CI only runs `npm test`.

**Suggested fix (follow-on):**
- Change `npm test` to run `node --import tsx --test` across all `*.test.ts` files (or add `npm run test:unit` / `test:all`).

### C) Cron overlap risks (Phase 55)
The EmailBison cron runs every minute. There is no explicit distributed lock/semaphore. Idempotency helps, but overlapping runs can still double-offer if both start before `offeredSlots` is written.

**Mitigation:** keep `maxDuration` low (it is currently 60s) and time budget conservative; consider adding a per-client lock if overlap is observed.

## Documentation Drift / “Paper Bugs”

- Phase 55 review mentions `maxDuration = 800`; code is currently `export const maxDuration = 60` in `app/api/cron/emailbison/availability-slot/route.ts`.
- Several older reviews mention “untracked” artifacts; the repo appears mostly clean now, so those notes may be stale/confusing for operators.

## Recommended Next Actions (priority order)

**P0 (ship blockers / stability):**
1) Triage and fix the current `/api/cron/appointment-reconcile` error flood (Phase 57).
2) Execute Phase 53 production rollout (schema → ship-check → backfill → deploy with flags off → enable flags gradually).
3) Run Phase 55 production dry-run + single-lead E2E verification.

**P1 (confidence / regression prevention):**
4) Run the manual smoke tests for: FC “double set”, auto-send, SmartLead/Instantly kernel, Notification Center.
5) Fix the test harness so `npm test` executes all unit tests.

**P2 (hardening):**
6) Address Phase 55 patch/persist ordering to avoid “offered slots that were never sent”.
7) Add minimal distributed locking if cron overlap is observed in logs.
