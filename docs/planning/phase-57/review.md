# Phase 57 — Review

## Summary
- Implemented fixes for the two dominant cron error signatures in `logs_result.json` (GHL appointment reconcile + insights booked summaries).
- Added blast-radius guardrails for `/api/cron/appointment-reconcile` (circuit breaker + `health` response field).
- Added production-hardening defaults for cron routes (`maxDuration`).
- Verified `npm test`, `npm run lint` (warnings only), and `npm run build` pass locally on **2026-01-26**.
- Converted the added tests under `lib/__tests__/` to the repo’s Node test runner and wired them into `npm test`.

## What Shipped
- `lib/ghl-api.ts`: normalize `getGHLAppointment()` responses via `normalizeGhlAppointmentResponse()` to unwrap `{ appointment: { ... } }`.
- `lib/ghl-appointment-reconcile.ts`: advance `Lead.appointmentLastCheckedAt` on all exit paths for `reconcileGHLAppointmentById()` to prevent retry storms.
- `lib/appointment-reconcile-runner.ts`: add a simple circuit breaker (50%+ error rate after ≥5 leads checked) that exits early and sets `result.circuitBroken`.
- `app/api/cron/appointment-reconcile/route.ts`: include `health` in JSON response (`healthy`/`degraded`/`unhealthy`/`circuit_broken`).
- `app/api/cron/appointment-reconcile/route.ts`: set `export const maxDuration = 800` to prevent premature timeouts under load.
- `lib/insights-chat/thread-extractor.ts`: clamp `agent_response` to 300 chars via Zod `.transform()` and add `maxLength: 300` to the JSON Schema sent to the model.
- `app/api/cron/insights/booked-summaries/route.ts`: set `export const maxDuration = 800` for long-running extractions.
- `lib/ai/prompt-registry.ts`: add a prompt/schema hint comment for `agent_response` length.
- Added and wired tests: `lib/__tests__/ghl-appointment-response.test.ts`, `lib/__tests__/insights-thread-extractor-schema.test.ts`.
- Added taxonomy artifact: `docs/planning/phase-57/taxonomy.md`.

## Verification

### Commands
- `npm run lint` — pass (warnings only) (2026-01-26)
- `npm run build` — pass (2026-01-26)
- `npm test` — pass (2026-01-26)
- `npm run db:push` — skipped (no `prisma/schema.prisma` changes in working tree)

### Notes
- Lint output: 0 errors, 18 warnings.
- Build output: successful; includes Next.js warnings about multiple lockfiles and deprecated middleware convention.
- Multi-agent / integration: working tree contains uncommitted code changes (6 modified files) plus untracked artifacts (`docs/planning/phase-56/`, `docs/planning/phase-57/`, `logs_result.json`, and the new test files). These fixes require commit + deploy to affect production.

## Success Criteria → Evidence

1. `/api/cron/appointment-reconcile` runs without `[Appointment Upsert] Missing ghlAppointmentId` errors.
   - Evidence: `lib/ghl-api.ts` now unwraps the GHL `{ appointment: {...} }` wrapper before returning `GHLAppointment` and otherwise fails fast before calling upsert.
   - Status: met (code-level fix; pending deploy/prod verification).

2. GHL reconcile-by-ID correctly upserts `Appointment` rows and updates `Lead` rollups.
   - Evidence: `lib/ghl-appointment-reconcile.ts` continues to call `upsertAppointmentWithRollup(...)` on success, and now always advances `appointmentLastCheckedAt` on error paths.
   - Status: partial (implementation present; not end-to-end verified against live GHL + DB in this review).

3. Error rate is bounded (guardrails prevent per-minute flood on repeated failures).
   - Evidence: `lib/ghl-appointment-reconcile.ts` watermark advancement prevents “same lead retried every minute”; `lib/appointment-reconcile-runner.ts` circuit breaker exits early on high error rate.
   - Status: met (code-level guardrails; pending deploy/prod verification).

4. Booked summaries cron no longer fails due to `agent_response` length violations.
   - Evidence: `lib/insights-chat/thread-extractor.ts` clamps `agent_response` to 300 chars and adds `maxLength: 300` to the structured output JSON Schema.
   - Status: met (eliminates the specific `too_big` failure mode; pending deploy/prod verification).

5. Regression tests for overlong strings are runnable in the repo test harness.
   - Evidence: `scripts/test-orchestrator.ts` now runs `lib/__tests__/insights-thread-extractor-schema.test.ts` via `node --test`, and `npm test` passes.
   - Status: met.

6. Add a lightweight “cron health” signal suitable for alerting.
   - Evidence: `app/api/cron/appointment-reconcile/route.ts` includes `health` and uses `result.circuitBroken` and `result.errors` thresholds.
   - Status: met.

## Plan Adherence
- Planned vs implemented deltas:
  - Circuit breaker is keyed off `errors / leadsChecked` (lead-level error rate), not per-workspace → acceptable, but should be documented if tuning is needed.

## Risks / Rollback
- Circuit breaker may stop processing early on transient provider outages → mitigated by returning partial results and surfacing `health=circuit_broken`; rollback is to revert the circuit breaker changes.
- Advancing `appointmentLastCheckedAt` on errors reduces retry noise but may delay re-checking a persistently failing lead → mitigated by the error logging plus optional follow-up to implement explicit retry/backoff controls.

## Follow-ups
- Commit + deploy the changes and monitor Vercel logs for disappearance of the old error signature.
- Optional: tune circuit breaker thresholds via `RECONCILE_CIRCUIT_BREAKER_ERROR_RATE` and `RECONCILE_CIRCUIT_BREAKER_MIN_CHECKS`.
- Suggested next phase: Phase 58 — Production verification + backfill execution (controlled reconcile run + monitoring).
