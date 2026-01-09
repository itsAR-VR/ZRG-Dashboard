# Phase 7a — Reproduce + Isolate the SMS/Phone Mismatch

## Focus
Confirm why leads can show SMS in GHL while the dashboard lead has no phone number (and/or hides the SMS channel).

## Inputs
- The affected lead email (e.g. `lead@example.com`) and any associated `ghlContactId`.
- Current SMS webhook handler: `app/api/webhooks/ghl/sms/route.ts`.
- Sync pipeline: `actions/message-actions.ts` + `lib/conversation-sync.ts`.
- Conversation UI channel gating: `actions/lead-actions.ts` + `components/dashboard/action-station.tsx`.

## Work
1. Inspect the lead row in DB: confirm `email`, `phone`, `ghlContactId`, `enrichmentStatus`.
2. Inspect recent webhook logs for that contact: verify whether the inbound SMS webhook payload includes `phone` and/or `email`.
3. Confirm whether SMS history sync succeeds via `ghlContactId` even when `Lead.phone` is null.
4. Trace where the UI decides which channel tabs render and when SMS is hidden.
5. Document the failure mode(s) (e.g., webhook payload missing `phone`, missing hydration step, UI gating on `Lead.phone`).

## Output
- A clear root-cause statement for the mismatch (what data is missing, where it should be hydrated, and what user-visible symptom it causes).

## Handoff
Proceed to implement GHL-based hydration rules in Phase 7b.
