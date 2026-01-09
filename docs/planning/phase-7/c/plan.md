# Phase 7c — Wire Hydration into Sync + UI Refresh + Channel Availability

## Focus
Ensure “Sync” actually fixes the user-visible issue: the lead should show a phone number and the SMS channel should render after sync/webhook ingestion.

## Inputs
- SMS sync: `lib/conversation-sync.ts` and `actions/message-actions.ts`
- Inbox UI:
  - Sync handlers: `components/dashboard/inbox-view.tsx`
  - Channel tabs: `components/dashboard/action-station.tsx`
  - Conversation shaping: `actions/lead-actions.ts`

## Work
1. Ensure SMS sync triggers lead hydration (even if no new messages are imported).
2. Propagate a “lead updated” signal through sync results so the client refreshes the active conversation.
3. Adjust channel availability computation so SMS is available when `ghlContactId` is present (even if the phone is missing temporarily).
4. Ensure channel tabs are not disabled purely because there are no existing messages in that channel (allow initiating SMS when possible).

## Output
- Manual “Sync” and “Sync All” update both messages and lead contact fields, and the UI reflects those updates immediately.

## Handoff
Add a backfill/repair strategy and observability in Phase 7d.

