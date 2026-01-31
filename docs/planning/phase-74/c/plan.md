# Phase 74c — Update Send Actions for To: Override

## Focus

Thread an explicit single-recipient `toEmail` (plus optional `toName`) through all email send paths, and persist the selection as the lead’s `currentReplier*` after a successful send.

## Inputs

- Phase 74b provides:
  - `toEmail` (single selected recipient)
  - `selectedToName` (optional display name)
  - `hasEditedTo` (whether the user explicitly changed To)
- Current send functions:
  - `actions/message-actions.ts`: `sendEmailMessage(leadId, content, { cc })`
  - `actions/email-actions.ts`: `sendEmailReply(draftId, content, { cc })`
  - `lib/email-send.ts`: `sendEmailReplySystem(...)` with smart TO/CC resolution

## Work

### 1. Update server action signatures

- `actions/message-actions.ts`
  - `sendEmailMessage(..., options?: { cc?: string[]; toEmail?: string; toName?: string | null })`
  - `approveAndSendDraft(..., options?: { cc?: string[]; toEmail?: string; toName?: string | null })`

- `actions/email-actions.ts`
  - `sendEmailReply(..., opts?: { cc?: string[]; toEmail?: string; toName?: string | null; ... })`
  - `sendEmailReplyForLead(..., opts?: { cc?: string[]; toEmail?: string; toName?: string | null; ... })`

### 2. Thread override into system send logic

- `lib/email-send.ts`
  - Extended `sendEmailReplySystem(...)` to accept:
    - `toEmailOverride?: string`
    - `toNameOverride?: string | null`
  - Applied override via `applyOutboundToOverride(...)` while preserving Phase 72 TO/CC swap semantics.
  - Updated outbound message persistence to store `toEmail/toName/cc` from the final resolved recipients.

### 3. Persist “current replier” after successful send

- `lib/email-send.ts`
  - When `toEmailOverride` is provided, persist:
    - `Lead.currentReplierEmail/currentReplierName/currentReplierSince`
    - Ensure `Lead.alternateEmails` includes the selected email (and excludes primary)
  - Logic implemented via `computeLeadCurrentReplierUpdate(...)`.

### 4. Wire UI sends

- `components/dashboard/action-station.tsx`
  - Pass `{ toEmail, toName }` to sends only when `hasEditedTo` is true.

## Output

- All email send paths accept optional `toEmail/toName` overrides.
- Overrides are applied for EmailBison + SmartLead sends; Instantly continues to rely on the reply handle (no To field).
- When an override is supplied, the lead’s persisted `currentReplier*` is updated post-send to keep future automation aligned.

## Handoff

Pass to Phase 74d for verification and testing.
