# Phase 74b — Make To: Field Editable

## Focus

Replace the read-only To: badge with an editable **single-select** (no free-form, no multi-To).

## Inputs

- Phase 74a has fixed the initial display value
- Existing `Lead` fields from Phase 72: `currentReplierEmail`, `currentReplierName`, `alternateEmails`
- Latest inbound email message (for `fromEmail` / `fromName`) is available in `conversation.messages`
- UI primitives: `components/ui/select`

## Work

Implemented in `components/dashboard/action-station.tsx`:

1. Updated `EmailRecipientEditor` props to accept:
   - `toEmail` (selected value)
   - `toOptions` (known participants only)
   - `onToEmailChange` (single-select change handler)

2. Replaced the To: badge with a `Select` UI control.

3. Added ActionStation state:
   - `toEmail` (selected recipient)
   - `hasEditedTo` (prevents background refreshes from clobbering user selection)

4. Built `toOptions` from:
   - `lead.currentReplierEmail/currentReplierName`
   - latest inbound `fromEmail/fromName`
   - `lead.email/lead.name`
   - `lead.alternateEmails`

5. Disabled send/approve actions and toasts an error if To is missing.

## Output

- To: field is editable via single-select (no free-form).
- The options list is derived from known thread participants.
- Empty To is blocked (warning + send disabled + toast on Enter/send).

## Handoff

Phase 74c should thread `toEmail/toName` through send actions and persist the chosen To as the lead’s current replier (post-send).
