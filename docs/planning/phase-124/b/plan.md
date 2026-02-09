# Phase 124b — Follow-Up Engine SMS Hardening (Hydration + Skip/Block Policy + DND Retry + Scheduling)

## Focus
Make SMS follow-up steps reliably send (or deterministically skip/block with a visible reason) by fixing the follow-up engine's SMS prerequisite logic, failure handling, DND retry strategy, and scheduling execution for minute-offset steps like "+2 minutes after setter reply" (including outside business hours for the **first step** of `triggerOn="setter_reply"` sequences).

## Inputs
- `lib/followup-engine.ts`
  - `processFollowUpsDue()`
  - `executeFollowUpStep()` (SMS channel branch ~line 1639 and SMS prerequisite checks ~line 836)
  - `resumeAwaitingEnrichmentFollowUps()` (~line 2348)
- `lib/followup-automation.ts`
  - `autoStartMeetingRequestedSequenceOnSetterEmailReply()` (anchor to outbound `sentAt`)
  - `startSequenceInstance()` (computes `nextStepDue` from `startedAt + step offset`)
- `lib/system-sender.ts`
  - `sendSmsSystem()` (GHL send + contact patch retry + DND handling)
- `lib/ghl-contacts.ts`
  - `resolveGhlContactIdForLead()` / `ensureGhlContactIdForLead()`
- `lib/reactivation-sequence-prereqs.ts` (reference for strict prereq semantics)
- UX requirement: **ZRG Workflow V1** Day 1 SMS should send ~2 minutes after the setter's first outbound email reply.

## Work
1. **Phone hydration before declaring "missing phone"**
   - When executing an SMS step and `Lead.phone` is missing, attempt a fast-path hydrate:
     - call `resolveGhlContactIdForLead(leadId)` (email-based match) to pull phone from GHL contact into DB when available.
     - re-fetch lead phone before deciding the SMS is blocked.
2. **SMS prerequisite policy**
   - If phone is still missing:
     - **skip the SMS step and advance** (no blocking), but:
       - create/update a `FollowUpTask` recording `SMS skipped — missing phone`
       - ensure the UI surfaces this outcome on the sequence card (see Phase 124d)
3. **SMS send failure policy**
   - If `sendSmsSystem()` fails:
     - **DND → bounded hourly retry** (see item 4 below).
     - Missing GHL config → pause as `blocked_sms_config` (do not advance).
     - Other errors → pause as `blocked_sms_error` (do not advance).
4. **DND bounded retry strategy** (RED TEAM GAP-3 decision)
   - When SMS fails due to DND:
     - Set `pausedReason: "blocked_sms_dnd:attempt:1"` and reschedule `nextStepDue` to +1 hour.
     - On each subsequent cron execution for this instance, if `pausedReason` starts with `"blocked_sms_dnd:attempt:"`:
       - Parse the attempt count.
       - If `attempt < 24`: re-attempt SMS send.
         - If DND still active: increment attempt, reschedule +1 hour.
         - If SMS succeeds: clear `pausedReason`, advance sequence normally.
       - If `attempt >= 24`: **give up** — skip SMS step, advance to next step, and record a `FollowUpTask` warning (kept `pending` so it remains visible/actionable in the current UI).
5. **Make non-delivery countable**
   - Create a `FollowUpTask` record for all blocked/skipped SMS cases (best-effort idempotent) so operators can audit "email sent but SMS blocked".
6. **Scheduling sanity**
   - Confirm "+2 minutes after setter reply" is anchored to `Message.sentAt` (already true via `startSequenceInstance(..., { startedAt: sentAt })`).
  - Ensure business-hours behavior is deterministic:
     - For `triggerOn="setter_reply"` sequences: bypass business-hours rescheduling for the **first step only** (preserve “+2 minutes” semantics). Later steps follow business hours.
     - For all other sequences: keep existing business-hours rescheduling behavior.

## Files Modified
- `lib/followup-engine.ts` — SMS prereq, skip/block policy, DND retry, business-hours bypass (setter-reply first step only)
- `lib/__tests__/followup-sms-*.test.ts` — new tests for missing-phone skip, DND retry, and blocked-error behavior

## Output
- SMS steps send when phone exists (including phones hydrated from GHL).
- When phone is missing after hydration, SMS is skipped and the sequence advances, with a FollowUpTask artifact and UI-visible warning.
- DND leads retry hourly for 24 attempts; after exhaustion, SMS is skipped with audit artifact and the sequence advances.
- The Day 1 SMS (+2 min) schedule is respected for ZRG Workflow V1 sequences, including outside business hours.

## Handoff
Proceed to **Phase 124c** to ensure reactivation campaigns hydrate and start follow-up sequences reliably for SMS steps.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented SMS "skip-with-audit" when phone is missing after best-effort GHL hydration; sequence advances instead of silently stalling. (file: `lib/followup-engine.ts`)
  - Added bounded DND retry behavior (`blocked_sms_dnd:attempt:N`) with hourly reschedule up to 24 attempts, then skip-with-audit and advance. (file: `lib/followup-engine.ts`)
  - Added explicit pause reasons for SMS config/errors and ensured all non-delivery outcomes create/update a `FollowUpTask` so they are countable and UI-visible. (file: `lib/followup-engine.ts`)
  - Bypassed business-hours rescheduling for `triggerOn="setter_reply"` sequences on the **first step only** so minute-offset steps (e.g., +2m SMS) execute when due while later steps still respect business hours. (file: `lib/followup-engine.ts`)
- Commands run:
  - `npm test` — pass (261 tests)
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - Manual QA still needed to confirm real GHL SMS send behavior and confirm the "+2 minutes after setter reply" timing in production-like conditions.
- Next concrete steps:
  - Run a controlled staging/prod test for a `triggerOn="setter_reply"` instance and confirm SMS send occurs ~2–3 minutes after email send (cron cadence).
  - Continue with Phase 124c reactivation hydration (implemented; see Phase 124c progress).
