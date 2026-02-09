# Phase 122 — Review

## Summary
- Shipped agent-driven booking-intent routing (Meeting Overseer → `deriveBookingSignal` → deterministic routes), removing regex-based acknowledgement gating.
- Tightened Meeting Overseer extract prompt so non-scheduling replies (e.g., "Thanks", "send details") do not become `acceptance_specificity="generic"`.
- Added unit tests covering booking-signal routing + generic-acceptance freshness rail.
- Verification: `npm test` passed; `npm run lint` passed (warnings only); `npm run build` failed in this sandbox due to a Turbopack panic, but `next build --webpack` passed.

## What Shipped
- `lib/followup-engine.ts`
  - Always runs `runMeetingOverseerExtraction(...)` for auto-booking decisions.
  - Fails closed (no auto-booking) if overseer extraction returns `null` (no heuristic fallbacks).
  - Introduced `deriveBookingSignal(...)` and route enum (`accept_offered` | `proposed_time` | `day_only` | `none`).
  - Removed regex-based generic acceptance checks; generic acceptance now requires a fresh offered slot and `offeredSlots.length === 1`.
  - Day-only routing avoids proposed-time parsing and selects availability via weekday.
- Meeting Overseer prompt tightening (no key bump):
  - `lib/ai/prompt-registry.ts` (`MEETING_OVERSEER_EXTRACT_SYSTEM_TEMPLATE`)
  - `lib/meeting-overseer.ts` (`systemFallback`)
- Tests:
  - `lib/__tests__/followup-booking-signal.test.ts`
  - `lib/__tests__/followup-generic-acceptance.test.ts`
  - `scripts/test-orchestrator.ts` (wired the new tests)

## Verification

### Commands
- `npm test` — pass (2026-02-09)
- `npm run lint` — pass (warnings only) (2026-02-09)
- `npm run build` — fail (2026-02-09)
  - Turbopack panic in this sandbox: “creating new process / binding to a port / Operation not permitted (os error 1)”
- `next build --webpack` — pass (2026-02-09)
- `npm run db:push` — skip (no Prisma schema changes in working tree)

### Notes
- Build failure appears environment-specific (sandbox OS restriction + Turbopack). Webpack build succeeded and is the recommended local validation command in this environment.

## Success Criteria → Evidence

1. Auto-book “generic acceptance” is decided by Meeting Overseer extraction (not regex), and still fails closed unless it is clearly a scheduling acknowledgement to a fresh offered-slot thread.
   - Evidence:
     - `lib/followup-engine.ts` (`deriveBookingSignal`, `route === "accept_offered"`, `isLowRiskGenericAcceptance`)
     - `lib/ai/prompt-registry.ts` + `lib/meeting-overseer.ts` prompt rules (generic is scheduling-only)
     - `lib/__tests__/followup-generic-acceptance.test.ts` (fresh/stale rails)
   - Status: met

2. Auto-book routing produces correct behavior for:
   - accept offered slot (exact match)
   - day-only (“Thursday works”) routing
   - proposed date+time parsing (timezone clarification when needed)
   - Evidence:
     - `lib/followup-engine.ts` route handling + Scenario 3 logic
     - Existing coverage: `lib/__tests__/followup-engine-dayonly-slot.test.ts`, `lib/__tests__/followup-booking-gate-retry.test.ts`
   - Status: met

3. Unit tests cover:
   - booking signal derivation from overseer decisions
   - date-only vs date+time routing behavior
   - “not interested / didn’t agree to a call” does not book even if thread contains offered slots
   - Evidence:
     - `lib/__tests__/followup-booking-signal.test.ts`
     - Existing Phase 121 coverage for quoted-thread stripping + non-scheduling replies (see `docs/planning/phase-121/review.md`)
   - Status: met

4. `npm test`, `npm run lint`, `npm run build` all pass.
   - Evidence:
     - `npm test` pass, `npm run lint` pass (warnings only)
     - `npm run build` fails under Turbopack in this sandbox; `next build --webpack` passes
   - Status: partial (sandbox-specific Turbopack panic)

## Plan Adherence
- Planned vs implemented deltas:
  - Added an extra mechanical guard for generic acceptance: only attempt it when `offeredSlots.length === 1`.
    - Impact: reduces wrong-slot booking risk without relying on message regexes.
  - Fail-closed hardening: removed heuristic fallback booking when overseer extraction is unavailable.
    - Impact: eliminates booking risk on AI outages/timeouts at the cost of reduced automation during those windows.

## Risks / Rollback
- Risk: If Meeting Overseer extraction is unavailable (timeouts/errors), the system will not auto-book (fail closed), which may reduce automation on transient AI outages.
  - Mitigation: optionally create a human follow-up task (or Slack alert) on overseer failure so the lead is not dropped.

## Follow-ups
- Optional: create a human follow-up task (or Slack alert) when Meeting Overseer extraction fails, so auto-book-eligible leads don't get dropped during transient AI failures.
- Optional: update `npm run build` script to force webpack in restricted environments (or document `next build --webpack` as the local validation command when Turbopack panics).
