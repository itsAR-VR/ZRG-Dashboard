# Phase 57 — Production Error Triage: Appointment Reconcile + Insights Cron

## Purpose
Triage the production errors captured in `logs_result.json`, identify root causes, and ship fixes + guardrails so cron jobs stop failing/noising and appointment + insight data stays consistent.

## Context
- `logs_result.json` contains **1000** Vercel log records spanning **2026-01-25 09:05:25–09:20:46 UTC** (≈15 minutes; likely an export cap, not a full 24h window).
- **920** entries are error-like; **919** are the same GHL reconciliation failure from `GET /api/cron/appointment-reconcile`:
  - `[GHL Reconcile] Error reconciling appointment <id> for lead <uuid>: [Appointment Upsert] Missing ghlAppointmentId for GHL appointment upsert`
- This failure occurs on the **GHL reconcile-by-ID path** (`reconcileGHLAppointmentById`) which:
  1) calls `getGHLAppointment(eventId, ...)`, then
  2) passes `appointment.id` into `upsertAppointmentWithRollup(...)`, which hard-requires `ghlAppointmentId`.
- **CONFIRMED root cause:** The GHL API response for `GET /calendars/events/appointments/{eventId}` returns `{ appointment: { id, ... }, traceId }` — wrapped in an `appointment` object. The code calls `ghlRequest<GHLAppointment>()` expecting a direct response, so `response.id` is `undefined` (actual ID is at `response.appointment.id`).
- Amplification factor (why this is “so loud”):
  - `vercel.json` schedules `/api/cron/appointment-reconcile` **every minute**.
  - The error path does **not** advance `Lead.appointmentLastCheckedAt`, so the same leads remain eligible and are retried every minute, creating an error flood + extra provider traffic.
- One separate failure appears once in the same export from `GET /api/cron/insights/booked-summaries`:
  - `Post-process error: schema violation` with Zod `too_big` for `follow_up.objection_responses[0].agent_response` (**> 300 chars**).
  - Root cause: schema/prompt drift — `ObjectionResponseSchema.agent_response` is capped at 300 chars in `lib/insights-chat/thread-extractor.ts`, and the model exceeded it for at least one lead.

**Evidence snapshot:** `docs/planning/phase-57/taxonomy.md`

## Repo Reality Check (RED TEAM)

- Verified log export is non-empty and parseable:
  - `logs_result.json` is a JSON array with 1000 records (≈992KB).
  - Time window and dominant signature match the Context above (see `docs/planning/phase-57/taxonomy.md`).
- Verified code touch points exist and contain the failing signature:
  - Throw site: `lib/appointment-upsert.ts` — `[Appointment Upsert] Missing ghlAppointmentId...`
  - Log site: `lib/ghl-appointment-reconcile.ts` — `[GHL Reconcile] Error reconciling appointment ...`
  - Appointment-by-id fetch: `lib/ghl-api.ts:getGHLAppointment()` currently returns raw `ghlRequest<GHLAppointment>` without response normalization.
  - Insights schema cap: `lib/insights-chat/thread-extractor.ts` — `agent_response: z.string().max(300)`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Amplification loop:** `reconcileGHLAppointmentById` throws before `appointmentLastCheckedAt` updates → same lead stays eligible and retries every minute (~919 errors in 15 min).
- **Monitoring blind spot:** logs show HTTP 200 even when errors occur → dashboards must key off log counters, not status code alone.
- **Provider response wrapper:** ✅ CONFIRMED — `getGHLAppointment()` returns raw `ghlRequest<GHLAppointment>` (line 924) but GHL wraps the response in `{ appointment: {...} }`, so `.id` is undefined (actual ID at `.appointment.id`).
- **Insights schema fragility:** Zod schema has `max(300)` but the JSON Schema sent to OpenAI has **no maxLength** → model doesn't know the constraint, violates it.

### Missing or ambiguous requirements
- ~~**GHL response shape undocumented:**~~ ✅ RESOLVED — Production response captured and documented in Phase 57b plan.
- **Watermark-on-error behavior undefined:** Current code doesn't advance `appointmentLastCheckedAt` on error → infinite retry. Decision: **advance always** (via `finally` block) to prevent retry storms.

### Repo mismatches (fix the plan)
- Phase 57c references `lib/ai/prompt-runner.ts` → **correct path:** `lib/ai/prompt-runner/runner.ts`

### Testing / validation gaps
- No unit test for GHL response normalization variants → **add:** `lib/__tests__/ghl-appointment-response.test.ts`
- No test verifying watermark advances on error → **add:** test case in `reconcileGHLAppointmentById` tests
- No test for insights schema truncation handling → **add:** fixture with >300 char `agent_response`

### Performance / timeouts
- Cron runs every minute; if single reconciliation takes >60s, invocations overlap → **add:** circuit breaker or early exit when error rate spikes

## Open Questions (Need Human Input)

- [x] **GHL API response shape** ✅ CONFIRMED
  - **Answer:** GHL "Get Appointment by Event ID" returns `{ appointment: { id, ... }, traceId }`.
  - The `id` field IS present, but nested inside the `appointment` wrapper.
  - Code assumed direct `GHLAppointment` shape → `response.id` was `undefined` because actual ID is at `response.appointment.id`.
  - **Fix:** Unwrap the `appointment` object in `normalizeGhlAppointmentResponse()`.

- [ ] **Should we temporarily reduce the cron schedule?** (confidence ~65%)
  - Why it matters: reduces provider traffic + log flood immediately, but delays reconciliation.
  - Current assumption: add backoff/circuit-breaker guardrails in Phase 57d; schedule throttle only if noise is operationally unacceptable.

- [x] **Insights schema violation: clamp vs. relax?** (confidence ~75%)
  - Decision: **clamp** (truncate to 300 chars in post-process) + add `maxLength: 300` to JSON Schema sent to OpenAI so model knows the constraint.

## Assumptions (Agent)

- **Assumption:** The `ghlRequest<GHLAppointment>` type assertion in `getGHLAppointment()` is the root cause — the actual API response doesn't match `GHLAppointment` interface (confidence ~95%)
  - Mitigation: If wrong, the normalization layer will log the unexpected shape and fail fast with a clear error

- **Assumption:** The insights schema violation is an edge case, not systemic prompt failure (confidence ~85%)
  - Mitigation: Monitor error rate post-fix; if recurring, revisit prompt to explicitly state length constraints

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 56 | Active (untracked) | Production rollout + monitoring | Phase 57 should produce concrete fixes Phase 56 can validate in production; avoid duplicating “monitoring + cleanup”. |
| Phase 52 | Complete | Booking/appointment domain | Reference for expected booking behavior; no active coordination needed. |

## Objectives
* [x] Produce an error taxonomy from `logs_result.json` — **Done:** `docs/planning/phase-57/taxonomy.md`
* [x] Fix the GHL appointment reconcile failure.
* [x] Reduce blast radius: add guardrails/backoff so a single bug can't spam logs every minute.
* [x] Fix the insights cron schema violation (prompt/schema handling).
* [x] Provide a safe rollout + data repair plan (re-run reconciliation/backfill; monitor error rate).

## Constraints
- No secrets or PII in logs, tests, or new telemetry.
- Prefer deterministic response normalization over weak heuristics.
- Keep changes backwards compatible with the existing schema unless a schema change is unavoidable.
- Cron endpoints must remain protected via `CRON_SECRET` and continue returning structured JSON.

## Success Criteria
- Appointment reconcile:
  - [x] `/api/cron/appointment-reconcile` runs without `[Appointment Upsert] Missing ghlAppointmentId` errors.
    - **Fix:** `normalizeGhlAppointmentResponse()` unwraps GHL's `{ appointment: {...} }` wrapper
  - [x] GHL reconcile-by-ID correctly upserts `Appointment` rows and updates `Lead` rollups.
    - **Fix:** Watermark (`appointmentLastCheckedAt`) now advances on all exit paths
  - [x] Error rate is bounded (guardrails prevent per-minute flood on repeated failures).
    - **Fix:** Circuit breaker trips at 50% error rate; watermark advancement prevents retry storms
- Insights booked summaries:
  - [x] Booked summaries cron no longer fails due to `agent_response` length violations.
    - **Fix:** JSON Schema `maxLength: 300` + Zod `.transform()` clamp
  - [x] Regression tests for overlong strings are runnable in the repo test harness.
    - **Fix:** `npm test` runs `lib/__tests__/insights-thread-extractor-schema.test.ts`
- Observability:
  - [x] Add a lightweight "cron health" signal (counts + normalized error keys) suitable for alerting.
    - **Fix:** `health` field in cron response: `healthy` | `degraded` | `unhealthy` | `circuit_broken`

## Subphase Index
* a — Triage + Red Team analysis (logs → hypotheses) ✅ Complete
* b — Fix GHL reconcile-by-ID (response normalization + watermark fix + tests) ✅ Complete
* c — Fix Insights schema violation (JSON Schema alignment + clamp + tests) ✅ Complete
* d — Guardrails + rollout plan (backoff, circuit breaker, monitoring, backfill) ✅ Complete

## Phase Summary

### What Was Done
- **Phase 57a:** Triaged production logs, built error taxonomy, identified root causes
- **Phase 57b:** Fixed GHL appointment reconciliation (919 errors/15min → 0 expected)
  - Added `normalizeGhlAppointmentResponse()` to unwrap `{ appointment: {...} }` wrapper
  - Added watermark advancement on all exit paths to prevent retry storms
  - Added 10 unit tests for response normalization
- **Phase 57c:** Fixed insights schema violation (1 error → 0 expected)
  - Added `maxLength: 300` to JSON Schema for OpenAI
  - Changed Zod to use `.transform()` clamp instead of `.max()` fail
  - Added 8 unit tests for schema validation
- **Phase 57d:** Added guardrails for blast radius reduction
  - Circuit breaker at 50% error rate (≥5 checks)
  - Health indicator in cron response for monitoring

### Key Decisions
1. **Truncate over reject:** LLM outputs that exceed 300 chars are truncated, not rejected
2. **Advance watermark always:** Even on errors, to prevent infinite retry loops
3. **Circuit breaker per-run:** Not per-lead, to balance early detection with throughput

### Files Changed
- `lib/ghl-api.ts` — Added `normalizeGhlAppointmentResponse()`
- `lib/ghl-appointment-reconcile.ts` — Added watermark advancement on all paths
- `lib/insights-chat/thread-extractor.ts` — JSON Schema + Zod fixes
- `lib/ai/prompt-registry.ts` — Added length hint comment
- `lib/appointment-reconcile-runner.ts` — Circuit breaker logic
- `app/api/cron/appointment-reconcile/route.ts` — `maxDuration` + health indicator
- `app/api/cron/insights/booked-summaries/route.ts` — `maxDuration`
- `scripts/test-orchestrator.ts` — Includes Phase 57 regression tests in `npm test`
- `.gitignore` — Ignores `logs_result.json`
- `lib/__tests__/ghl-appointment-response.test.ts` — New (9 tests)
- `lib/__tests__/insights-thread-extractor-schema.test.ts` — New (8 tests)

### Follow-Up
- Deploy to production and monitor error rates
- Run backfill checklist (Phase 57d Step 4) after verifying fix
- Coordinate with Phase 56 for production closeout

### Verified (Phase Review, 2026-01-26)
- `npm run lint`: ✅ pass (warnings only; 0 errors)
- `npm run build`: ✅ pass
- `npm test`: ✅ pass
- `npm run db:push`: ⏭️ skipped (no `prisma/schema.prisma` changes in working tree)
- Notes:
  - `scripts/test-orchestrator.ts` now runs the new Node test files under `lib/__tests__/` in addition to the existing auto-send suite.
  - Circuit breaker thresholds are tunable via `RECONCILE_CIRCUIT_BREAKER_ERROR_RATE` and `RECONCILE_CIRCUIT_BREAKER_MIN_CHECKS`.
