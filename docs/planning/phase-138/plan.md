# Phase 138 — Robust Auto-Booking + Qualification-Aware Scheduling (No Double-Sends)

## Purpose

Fix auto-booking failures for relative-time proposals ("today at 5pm", "tomorrow morning"), eliminate contradictory double-sends, and require qualification-aware booking decisions so scheduling only auto-books when intent, qualification, and proposed timing all align.

## Context

**Incident context (Jam `1100b87c-ed92-4ab3-a6d2-404897314e96`):**
A lead replied: *"I'd love to learn more. Today at 5pm works thanks!"* with a phone number in signature.

Observed failure pattern:
1. Auto-booking failed to match proposed time to availability.
2. System generated contradictory outbound content ("we'll call your cell" + scheduling clarification).
3. Booking did not complete.

## Phase Status (Post-Progress)

- Implemented in code this turn (phase-138 scope):
  - `AutoBookingContext`/`AutoBookingResult` return-shape and failure taxonomy in `lib/followup-engine.ts`.
  - Nearest-slot fallback + tie-later policy + relative-date resolver in `lib/followup-engine.ts`.
  - Qualification-aware and body-grounded overseer extraction schema/prompt in `lib/meeting-overseer.ts`.
  - Draft suppression and scheduling-aware prompt context across all runtime pipelines + `lib/ai-drafts.ts`.
  - Additional hardening fixes from RED TEAM pass:
    - Email background fallback now always provides `autoBook.context`.
    - `accept_offered` route now enforces `time_from_body_only` gate.
- Validation status:
  - `npm run lint -- --max-warnings 9999` passed (warnings only, no errors).
  - Targeted tests passed: `followup-generic-acceptance`, `followup-booking-signal`, `followup-engine-dayonly-slot` (full orchestrator run: 332 pass, 0 fail).
  - `npm run build` still failing due non-phase-138 build blocker (`/_not-found` prerender error, digest `2274253006`).
- Current execution state:
  - Subphases `138a`-`138e` are implemented/documented.
  - Phase exit is still pending subphase `138f` (residual explicit tests + build-blocker ownership resolution).

## Repo Reality Check (RED TEAM)

- Verified current auto-booking entrypoint:
  - `lib/followup-engine.ts` → `processMessageForAutoBooking(...)`
- Verified runtime pipelines that call auto-booking and may generate drafts:
  - `lib/inbound-post-process/pipeline.ts` (email pipeline)
  - `lib/background-jobs/email-inbound-post-process.ts` (email background job)
  - `lib/background-jobs/sms-inbound-post-process.ts` (SMS background job)
  - `lib/background-jobs/linkedin-inbound-post-process.ts` (LinkedIn background job)
- Verified draft generation + meeting overseer integration points:
  - `lib/ai-drafts.ts` (`DraftGenerationOptions`, prompt assembly, overseer gate memory context)
- Verified meeting overseer extraction schema + prompt:
  - `lib/meeting-overseer.ts`
- Verified qualification and business context sources:
  - `lib/qualification-answer-extraction.ts`
  - `lib/lead-context-bundle.ts`
  - `WorkspaceSettings.serviceDescription`, `WorkspaceSettings.qualificationQuestions`, knowledge assets context
- Verified test touchpoints impacted by return-shape/schema changes:
  - `lib/__tests__/followup-generic-acceptance.test.ts`
  - `lib/__tests__/followup-booking-signal.test.ts`

## RED TEAM Findings (Gaps / Weak Spots)

### Resolved this turn

- Runtime consumer coverage now includes all 4 pipelines.
- Scheduling task context now propagates to draft suppression checks.
- Nearest-slot tie behavior implemented with deterministic later-slot selection.
- Qualification-aware booking gates enforced before booking attempts.
- `accept_offered` now also fails closed when time is not body-grounded.

### Remaining gaps / risks

- Missing dedicated unit tests for nearest-slot helper behavior (`exact`/`nearest`/`nearest_tie_later`/out-of-window) and explicit `accept_offered + !time_from_body_only` path.
- Full build gate is currently blocked by non-phase-138 failures during static generation (`/_not-found` prerender digest `2274253006`).

### Performance / timeout constraints

- Overseer extraction remains latency-sensitive; bounded context packaging is in place.
- No heavy synchronous fetches were added to non-scheduling paths.

### Security / permissions

- No new auth surfaces were introduced.
- Blocked-sentiment protections (`Automated Reply`, `Out of Office`, `Blacklist`) preserved.

## Concurrent Phases and Coordination

| Phase | Status | Overlap | Coordination Requirement |
|-------|--------|---------|--------------------------|
| 137 | Active | `lib/ai-drafts.ts` | Re-read current file before edits; merge semantically, not by line-number assumptions. |
| 139 | Active | `lib/followup-engine.ts`, `lib/ai-drafts.ts`, `lib/meeting-overseer.ts`, `lib/inbound-post-process/pipeline.ts` | Rebase phase-138 edits on latest file state and record conflict-resolution notes. |
| 140 | Active | `lib/ai-drafts.ts` | Avoid pricing-specific sections while applying scheduling changes. |
| 134 | Complete | `processMessageForAutoBooking` sentiment guards | Preserve and extend; no regression in blocked-sentiment behavior. |

## Pre-Flight Conflict Check (Required Before Each Subphase)

- [x] Run `git status --porcelain` and verify current shared-file state.
- [x] Re-read current versions of files changed in this turn.
- [x] Confirm no stale line-number assumptions; anchor by function names.
- [x] Document overlap handling with phases 137/139/140 in subphase notes.

## Objectives

- [x] Auto-book "today at 5pm" and similar relative-time proposals via nearest-slot matching.
- [x] Resolve "today"/"tomorrow" into concrete day selection for day-only fallback.
- [x] Extend `processMessageForAutoBooking` with rich scheduling + qualification context on every return path.
- [x] Add qualification-aware booking logic in meeting overseer extraction and booking decisioning.
- [x] Prevent double-sends in all runtime pipelines by skipping drafts when scheduling is already handled by auto-booking task creation.
- [x] Make AI draft generation scheduling-aware when drafting still runs.

## Constraints

- Preserve exact-match behavior as first-path logic.
- Preserve booking gate as the secondary safety check when enabled.
- Non-scheduling messages must retain normal draft flow.
- Keep blocked-sentiment early exits intact.
- Ensure all return paths from `processMessageForAutoBooking` include context.
- Keep changes surgical: modify only booking/overseer/draft coordination paths required by this phase.

## Resolved Decisions

- **Scope decision:** Include qualification-aware booking in phase 138 (not split to follow-on).
- **Nearest-slot tie policy:** If two slots are equally close, auto-book the **later** slot.
- **Tie confirmation messaging:** Confirm exact booked time and include correction clause.
- **Draft suppression default:** Skip draft generation whenever auto-booking created a scheduling follow-up task.

## Success Criteria

- [x] "Today at 5pm" path supports exact/nearest-slot booking logic.
- [x] "Tomorrow morning" path resolves via weekday-aware fallback logic.
- [x] Equidistant tie case uses later-slot strategy with correction wording support.
- [x] Unqualified/unknown qualification blocks auto-booking and creates scheduling/qualification follow-up task.
- [x] Scheduling failure paths suppress contradictory double-send across runtime pipelines.
- [x] Non-scheduling messages continue normal draft behavior.
- [x] `npm run lint` passes.
- [ ] `npm run build` succeeds (currently blocked by repo-wide prerender failure outside phase-138 touchpoints).

## Subphase Index

- a — AutoBookingResult/Context Foundation + Full Return-Path Coverage
- b — Nearest-Slot Matching + Relative Date Resolution + Tie Policy
- c — Qualification-Aware Meeting Overseer Extraction + Booking Preconditions
- d — Pipeline Coordination + Draft Scheduling Awareness (All Runtime Pipelines)
- e — Coordination Hardening, Tests, and Documentation Updates
- f — Residual Coverage + Build-Blocker Triage for Phase Exit

## Open Questions (Need Human Input)

- [ ] Should phase 138 own remediation of the current global `npm run build` prerender blocker (`/_not-found`, digest `2274253006`), or should that stay with the active UI/site-wide phases (137/140)? (confidence ~70%)
  - Why it matters: phase-exit criteria currently require build success, and this blocker is outside the files modified for 138.
  - Current assumption in this plan: treat build blocker as external and continue closing 138-specific coverage + docs.

## Assumptions (Agent)

- Auto-booking fallback objects in non-auto-book branches must always include a full `context` payload for downstream draft suppression consistency. (confidence ~95%)
- `time_from_body_only` should be enforced for all booking routes (`accept_offered`, `proposed_time`, `day_only`) to fail closed against signature/footer leakage. (confidence ~92%)

## Phase Summary (running)

- 2026-02-11 22:09:49Z — Implemented phase-138 booking/overseer/pipeline/draft integration changes and reconciled sub-agent RED TEAM findings (files: `lib/followup-engine.ts`, `lib/meeting-overseer.ts`, `lib/ai-drafts.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, `lib/background-jobs/linkedin-inbound-post-process.ts`, `README.md`, `lib/__tests__/followup-generic-acceptance.test.ts`, `lib/__tests__/followup-booking-signal.test.ts`).
- 2026-02-11 22:09:49Z — Validation checkpoints recorded: lint pass (warnings only), targeted tests pass (332/332), build blocked by repo-wide prerender error (`/_not-found`, digest `2274253006`).
