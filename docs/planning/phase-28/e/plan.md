# Phase 28e — Cancellation Handling, Follow-Up Gating, and Mismatch Reporting

## Focus
Finalize the product semantics: handle cancellations/reschedules, ensure automation respects verified booking state, and provide a discrepancy report to audit “sentiment vs provider evidence”.

## Inputs
- Root context: `docs/planning/phase-28/plan.md`
- Schema decision: `docs/planning/phase-28/a/plan.md`
- Reconciliation output:
  - `docs/planning/phase-28/b/plan.md` (GHL)
  - `docs/planning/phase-28/c/plan.md` (Calendly)
  - `docs/planning/phase-28/d/plan.md` (cron/backfill)
- Follow-up gating: `lib/followup-automation.ts`, `lib/meeting-booking-provider.ts`
- Sentiment/status mapping: `lib/sentiment-shared.ts`

## Work
1. Define “meeting completed” rules:
   - Document current state: we do not have reliable attended/showed tracking yet across providers.
   - For now: treat verified booking as “completed” (explicitly documented so the product doesn’t pretend it’s attendance).
   - Capture future requirements in README + follow-up phase: attended/no-show signals (GHL appointment status webhooks, Calendly invitee no_show, or manual marking).
2. Decide how completion surfaces in the UI:
   - Add `Meeting Completed` as a sentiment tag (and map to a lead status like `meeting-completed`), or
   - Keep it as a separate lead status/badge derived from appointment fields.
3. Automation correctness:
   - Confirm follow-up enrollment is blocked for booked leads based on provider evidence (not sentiment).
   - Ensure existing follow-up instances are completed/paused when booking becomes verified.
   - Decide what happens on cancellation (e.g., re-qualify lead and allow follow-ups again).
   - On cancellation/reschedule: create a FollowUpTask for manual review (setter-managed) or to re-book (AI-managed), and surface it with a “red” indicator in the UI.
     - Setter-managed vs AI-managed: derive from the lead’s campaign mode when available (e.g., `EmailCampaign.responseMode` / equivalent workspace config); default to manual review when unknown.
     - Suggested task types: `meeting-canceled` / `meeting-rescheduled` (rendered as red in Follow-ups UI).
4. Mismatch reporting (operator visibility):
   - Produce a query/report (admin route or internal dashboard) to list:
     - `sentimentTag = "Meeting Booked"` but no provider evidence
     - provider evidence exists but lead not marked booked
     - appointment in the past but not marked completed
   - Include lead IDs + workspace IDs, plus non-PII “triage fields” that explain recent activity without exposing message content:
     - `lastInboundAt`, `lastMessageAt`, `lastMessageDirection` (and optionally last outbound)
   - When mismatch is confirmed:
     - Provider evidence wins over AI sentiment (upgrade to “Meeting Booked” as applicable).
     - If sentiment says “Meeting Booked” but provider evidence is missing, downgrade sentiment (exact downgrade target TBD).
   - Decision: downgrade “Meeting Booked” → “Meeting Requested” when provider evidence is missing.
5. Validation:
   - Add targeted tests for state transitions if a harness exists; otherwise add a small deterministic “reconciliation simulator” for local verification.

## Output

### Files Created/Modified

1. **`lib/appointment-mismatch-report.ts`** - **New file** with mismatch detection and reporting:
   - `generateMismatchReport(opts)` - Generates full report with records
   - `getMismatchCounts(opts)` - Fast counts-only query
   - `autoCorrectMismatches(opts)` - Applies authority rules to fix mismatches

2. **`app/api/admin/appointment-mismatches/route.ts`** - **New admin endpoint**:
   - GET: Returns mismatch report (supports `countsOnly=true` for faster queries)
   - POST: Auto-corrects mismatches by applying authority rules
   - Authentication: Requires `ADMIN_API_KEY` header

### Mismatch Types Detected

| Type | Description | Auto-Correction |
|------|-------------|-----------------|
| `sentiment_booked_no_evidence` | Lead has "Meeting Booked" sentiment but no provider IDs | Downgrade to "Meeting Requested" |
| `evidence_exists_not_booked` | Provider IDs exist (not canceled) but lead status ≠ "meeting-booked" | Upgrade to "meeting-booked" |
| `canceled_but_booked_status` | Appointment is canceled but lead status is still "meeting-booked" | Revert to "qualified" |

### Authority Rules (Implemented)

1. **Provider evidence wins over sentiment** - If evidence exists and isn't canceled, lead is booked
2. **"Meeting Booked" without evidence → "Meeting Requested"** - Downgrade sentiment
3. **Canceled appointment → "qualified" status** - Revert lead to re-qualification

### Follow-Up Gating (Already Implemented)

The `isMeetingBooked()` function in `lib/meeting-booking-provider.ts` already correctly gates follow-ups:
- Uses provider evidence (GHL appointment ID or Calendly URIs)
- Respects `appointmentStatus` - returns false if canceled
- Does NOT rely on sentiment tag alone

### Meeting Completion (Deferred)

Per Phase 28a decision:
- No separate "Meeting Completed" status/sentiment added
- Reason: No reliable attendance/no-show tracking available yet
- Future: Add `showed` / `no_show` handling when provider signals are available

### Admin Endpoint Usage

```bash
# Get mismatch counts (fast)
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://app/api/admin/appointment-mismatches?countsOnly=true"

# Get full report for a workspace
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://app/api/admin/appointment-mismatches?clientId=xxx&limitPerType=50"

# Auto-correct mismatches
curl -X POST -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://app/api/admin/appointment-mismatches?clientId=xxx"
```

## Handoff

Phase 28 is complete. If mismatch reporting reveals systemic gaps (e.g., missed webhook coverage), create a follow-up phase to:
- Add GHL appointment status webhooks for attended/no-show tracking
- Add Calendly invitee no_show detection
- Harden webhook ingestion to reduce reconciliation load

## Review Notes

- Evidence:
  - Mismatch report: `lib/appointment-mismatch-report.ts`
  - Admin endpoint: `app/api/admin/appointment-mismatches/route.ts`
  - Cancellation task creation: `lib/appointment-cancellation-task.ts`
- Updates (2026-01-17):
  - Cancellations now create FollowUpTasks with type `meeting-canceled`.
  - `isRedIndicatorTaskType()` helper added for UI styling.
  - Integrated into both GHL and Calendly reconciliation modules.
- Notes:
  - "Meeting Completed" remains deferred; booked is treated as completed until attendance tracking exists.
