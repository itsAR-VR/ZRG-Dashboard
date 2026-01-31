# Phase 74a — Fix CC Replier Display in To: Field

## Focus

Fix the Phase 72 incomplete implementation where the frontend still shows `lead.email` instead of `currentReplierEmail` when a CC'd person has replied.

## Inputs

- `components/dashboard/action-station.tsx` lines 816-819 hardcode `lead.email`
- `Lead` type already has `currentReplierEmail` and `currentReplierName` fields
- These fields are populated by inbox-view.tsx when loading conversations

## Work

1. Read current state of `action-station.tsx` (may have Phase 72 changes)

2. Update `EmailRecipientEditor` props (lines 816-819):
   ```tsx
   // Before:
   toEmail={lead.email}
   toName={lead.name}

   // After:
   toEmail={lead.currentReplierEmail || lead.email}
   toName={lead.currentReplierName || lead.name}
   ```

3. Verify the `lead` object includes these fields (destructured from `conversation` on line 533)

4. Test: Find a lead with `currentReplierEmail` set, verify To: shows the replier

## Output

- Updated `components/dashboard/action-station.tsx` to display:
  - `toEmail = lead.currentReplierEmail || lead.email`
  - `toName = lead.currentReplierName || lead.name`
- Frontend now reflects Phase 72’s `currentReplier*` fields for the default To: display.

## Handoff

Phase 74b can now replace the read-only To: badge with an editable single-select control and wire state into sends.
