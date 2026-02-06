# Phase 113 — Booking-First Auto-Book Hardening (Gate All Scenarios + Day-Only Auto-Book + One-Retry Loop)

## Purpose
Improve auto-booking conversion while reducing wrong-book risk by:
- running the **booking safety gate** across **all** booking scenarios (not just proposed-time matches)
- supporting **day-only** scheduling replies ("Thursday works") by auto-booking the **earliest available slot** on that day
- adding a **single retry** loop when the gate returns `needs_clarification`, and escalating to a **FollowUpTask + Slack alert** when still unclear

This phase builds directly on Phase 112’s `followup.booking.gate.v1` + `LeadContextBundle` + confidence governance foundations.

## Decisions (Locked 2026-02-06)
- Booking gate scope: **Scenario 1 + 2 + 3**.
  - Scenario 1/2: lead accepts an offered slot (specific/day-only/generic acceptance).
  - Scenario 3: no offered slots; lead proposes their own time OR provides day-only preference.
- Gate behavior:
  - If gate returns `needs_clarification`: **retry once** with richer structured context, then decide.
  - If still unclear (or model fails): **create FollowUpTask** (no auto-book) and send a **Slack alert**.
- Gate failure handling (`null`): **fail closed always** (create FollowUpTask + Slack alert; do not auto-book).
- Proposal governance remains:
  - approve/reject: workspace admin
  - apply/rollback: true super-admin
- Telemetry strategy remains:
  - keep stats-only post-call `AIInteraction.metadata` updates

## Context (Repo Reality)
Existing auto-booking flow lives in:
- `lib/followup-engine.ts` (`processMessageForAutoBooking`)
  - Scenario 1/2 accepts offered slots and books directly.
  - Scenario 3 proposed-time match uses `parseProposedTimesFromMessage(...)` and (when enabled) `followup.booking.gate.v1`.
- Meeting overseer extraction provides key structured fields:
  - `runMeetingOverseerExtraction(...)` in `lib/meeting-overseer.ts`
  - includes `acceptance_specificity`, `preferred_day_of_week`, `preferred_time_of_day`, `relative_preference`, `needs_clarification`, etc.
- Booking gate prompt is registry-backed:
  - `followup.booking.gate.v1` in `lib/ai/prompt-registry.ts`
- Rollout gating is already in place:
  - `WorkspaceSettings.autoBookMeetings`
  - `WorkspaceSettings.leadContextBundleEnabled`
  - `WorkspaceSettings.followupBookingGateEnabled`
  - env kill-switch: `LEAD_CONTEXT_BUNDLE_DISABLED=1`

## Objectives
1. Run booking gate for **all** auto-book scenarios (1/2/3) when toggles are enabled.
2. Support **day-only** booking (no offered slots): select earliest available slot on the requested day and book it when safe.
3. Implement **one retry** on `needs_clarification` using richer structured context (offered slots ledger, candidate slots list, overseer extraction summary).
4. If still unclear after retry: create FollowUpTask + send Slack alert (no auto-book).
5. Add targeted regression tests for:
   - day-only slot selection
   - gate call conditions + retry behavior
   - idempotency (`messageId_stage` upsert)

## Scope
In scope:
- `lib/followup-engine.ts` (scenario logic + gate wiring + retry + slack escalation)
- `lib/ai/prompt-registry.ts` (booking gate prompt tweaks to be scenario-aware, without bumping prompt key)
- Tests under `lib/__tests__/*` + `scripts/test-orchestrator.ts`

Out of scope:
- Changes to provider booking implementations (`lib/booking.ts`)
- Auto-sending clarifications (clarifications remain human-routed via FollowUpTask)
- Removing post-call metadata update writes (keep as-is for now)

## Constraints / Guardrails
- Prioritize booking, but do not book when intent is clearly not scheduling-related (use meeting overseer extraction + existing heuristics).
- No raw message text, lead memory, or knowledge assets stored in telemetry metadata.
- Preserve idempotency: do not create duplicate booking gate decisions per message.
- Keep prompt keys stable (no `followup.booking.gate.v2` in this phase).

## Success Criteria
- [x] When enabled, the booking gate runs for Scenario 1/2 bookings and can block/escalate safely.
- [x] Day-only replies (e.g., “Thursday works”) can result in a booked meeting (earliest slot that day), with confirmation sent afterward.
- [x] Gate retry happens at most once; final fallback produces a FollowUpTask + Slack alert.
- [x] `npm test`, `npm run lint`, `npm run build` pass.

## Subphase Index
1. **a** — Make booking gate scenario-aware and run it for Scenario 1/2 (accept-offered path)
2. **b** — Implement day-only booking (Scenario 3 extension) with deterministic slot selection
3. **c** — Add one-retry loop + Slack escalation + tests/validation

## Phase Summary (running)
- 2026-02-06 — Implemented scenario-aware booking gate plumbing and wired gate into Scenario 1/2 accept-offered bookings (files: `lib/followup-engine.ts`, `lib/ai/prompt-registry.ts`, `docs/planning/phase-113/a/plan.md`).
- 2026-02-06 — Added Scenario 3 day-only auto-book fallback (weekday-only replies) and safer follow-up suggestion copy for non-exact proposals (files: `lib/followup-engine.ts`, `docs/planning/phase-113/b/plan.md`).
- 2026-02-06 — Added one-retry loop for booking gate uncertainty plus Slack escalation and unit tests; validated with lint/build/test (files: `lib/followup-engine.ts`, `lib/__tests__/followup-booking-gate-retry.test.ts`, `scripts/test-orchestrator.ts`, `docs/planning/phase-113/c/plan.md`).
- 2026-02-06 — Phase complete; review written and follow-up work planned in Phase 114 (files: `docs/planning/phase-113/review.md`, `docs/planning/phase-114/plan.md`).

## Repo Reality Check (RED TEAM)
- What exists today:
  - Auto-book orchestrator: `lib/followup-engine.ts` (`processMessageForAutoBooking`)
  - Booking gate prompt: `followup.booking.gate.v1` in `lib/ai/prompt-registry.ts`
  - Overseer extraction: `lib/meeting-overseer.ts` (`runMeetingOverseerExtraction`)
  - Availability cache: `lib/availability-cache.ts` (`getWorkspaceAvailabilitySlotsUtc`)
  - Test harness: `scripts/test-orchestrator.ts`
- Verified touch points:
  - Scenario-aware gate runs across accept-offered / proposed-time match / day-only (code + prompt).
  - Retry-once behavior is bounded (helper test coverage).

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Booking gate can return `null` (bundle build failure/timeout or LLM failure): conversion impact if dependencies are flaky → **locked decision is fail-closed**; monitor Slack alert volume and revisit only with an explicit product decision.
- Day-only auto-book ignores time-of-day words when overseer is not run (e.g., “Thursday morning”) → could book a non-matching time; consider a follow-up phase to filter by time-of-day when present.

### Observability / noise
- Slack escalation is sent only for: `needs_clarification` after retry and gate failures (not for explicit `deny`) → reduces noise, but may hide systematic denies if you wanted visibility.

## Open Questions (Need Human Input)
- [x] Should Slack escalation also fire for explicit booking-gate `deny` outcomes?
  - Resolved: **No** (avoid Slack noise); instead provide “last 3 days” AI/booking visibility in the Admin Dashboard (planned in Phase 114).
- [x] Should day-only auto-book apply when offered slots exist but the lead asks for a different weekday than any offered slot?
  - Resolved: **Yes, if gate approves** — planned follow-up work in Phase 114 (Phase 113 only covered Scenario 3 day-only).
