# Phase 62g — Hardening: Required-Answer Completeness + Centralized Auto-Book Integration

## Focus
Make dual-link direct booking reliable by (1) gating on **required-answer completeness** and (2) ensuring “extract answers (if needed)” happens before any Calendly booking attempt across *all* inbound entrypoints.

## Inputs
- Phase 62a–62f planned outputs (schema + UI + extraction + booking routing + Calendly API)
- Auto-book entrypoints (repo reality):
  - `lib/followup-engine.ts:processMessageForAutoBooking()`
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `app/api/webhooks/email/route.ts`
- Qualification-question sources:
  - `WorkspaceSettings.qualificationQuestions` (JSON array)
  - `LeadCampaignBookingProgress.selectedRequiredQuestionIds` (asked required question IDs)

## Work
1. **Define “answer readiness” contract**
   - Replace the ambiguous `hasQualificationAnswers()` meaning with a readiness function:
     - `hasAnyAnswers`
     - `hasAllRequiredAnswers` (for the asked/required subset)
     - `missingRequiredQuestionIds`
   - Use **required-answer completeness** (not “any answer”) as the routing gate for questions-enabled Calendly booking.

2. **Centralize “extract-if-needed” at booking time**
   - Ensure a booking attempt can never happen on Calendly required-question event types without first ensuring required answers are available.
   - Preferred design: call extraction from the shared auto-book path (`processMessageForAutoBooking()`), just before calling `bookMeetingForLead()`, with:
     - strict timeout (non-blocking; error → safe fallback)
     - gating (only run if we have evidence questions were asked, e.g. `selectedRequiredQuestionIds.length > 0`)
     - transcript built from recent messages (bounded window + includes outbound questions)
   - Alternative design (acceptable): integrate into `bookMeetingOnCalendly()` so *all* call sites are covered even if auto-book entrypoints diverge.
   - Document which approach is chosen and why.

3. **Add booking fallbacks**
   - If questions-enabled Calendly booking fails with a 4xx that indicates question mismatch/missing required answers:
     - retry once using direct-book event type (if configured) with no `questions_and_answers`
   - If still failing:
     - create a follow-up task for manual intervention and log a clear error key for debugging.

4. **Observability**
   - Add consistent logging (or telemetry) for:
     - which booking route was chosen (questions-enabled vs direct-book)
     - why (all-required-answered, missing-required, extraction-error, retry-fallback)
     - provider error status codes (without leaking PII).

## Validation (RED TEAM)
- [ ] Prove all auto-book entrypoints are covered by the centralized integration (single choke point or explicit wiring checklist).
- [ ] Unit test: “required-answer completeness → route selection” (prevents regressions where partial answers cause booking failures).
- [ ] Manual smoke: forced failure on questions-enabled event type triggers retry to direct-book event type.

## Output
- A hardened implementation plan that guarantees no silent Calendly failures due to missing qualification answers.

## Handoff
Proceed to Phase 62h to implement Scenario 3 (lead-proposed time auto-booking) or confirm it should be manual-only.

