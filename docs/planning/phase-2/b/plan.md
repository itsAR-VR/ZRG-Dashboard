# Phase 2b — Fix: SMS DND non-retriable handling in follow-ups

## Focus
Stop cron retry loops when GHL rejects an SMS due to DND, while keeping follow-up sequences consistent and multi-channel friendly.

## Inputs
- Phase 2a decisions for “DND means what?” (advance vs pause)
- Relevant code:
  - `lib/followup-engine.ts` (SMS execution branch)
  - `actions/message-actions.ts` `sendMessage()` (SMS send + DB write)
  - `lib/ghl-api.ts` (`ghlRequest`, error text includes JSON payload)

## Work
- Add a reliable DND detection mechanism:
  - Prefer parsing the GHL JSON error payload in `lib/ghl-api.ts` to surface a stable error code (e.g. `sms_dnd`) rather than brittle substring matching.
- Update follow-up SMS execution handling:
  - When the failure is DND, return `{ success: true, action: "skipped", advance: true }` (or the Phase 2a-chosen behavior).
  - Optionally create a `FollowUpTask` row with `status="skipped"` so operators can see why the step didn’t send.
  - Consider optional notification (Slack) only if it won’t spam (e.g., first occurrence per lead/sequence).
- Ensure manual SMS sending surfaces a user-friendly message for DND.
- Add minimal regression coverage (if an existing test harness exists) or a deterministic “local verification” script/checklist.

## Output
- Implemented DND detection + non-retriable follow-up behavior:
  - `lib/ghl-api.ts` now parses JSON error payloads (when present) and surfaces:
    - `statusCode` (HTTP status)
    - `errorCode: "sms_dnd"` for the known DND case
    - `errorMessage` (parsed `message` field)
  - `actions/message-actions.ts` `sendMessage()` now:
    - Detects DND via `result.errorCode === "sms_dnd"` (fallback to message substring)
    - Marks the lead `smsDndActive=true` and returns `{ success:false, errorCode:"sms_dnd" }`
    - Uses a neutral error message (no “will retry automatically” wording)
  - `lib/followup-engine.ts` now treats SMS DND as **skipped + advance**:
    - Creates `FollowUpTask(status="skipped")` for visibility
    - Logs `[FollowUp] SMS step skipped ... DND active` and avoids retry loops

This aligns cron behavior with the Phase 2a decision: DND is treated as non-retriable for follow-up sequences.

## Handoff
Proceed to Phase 2c adjusting availability cache refresh so “No default calendar link configured” becomes a `skippedNoDefault` count (not an error), with backoff to avoid repeat logs every cron run.
