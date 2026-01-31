# Phase 74 — Editable Email To: Field + CC Replier Display Fix

## Purpose

Fix the email reply composer to:
1. Display the current CC replier (from Phase 72) as the To: recipient when applicable
2. Make the To: field editable so users can change/remove recipients

## Context

### User Request

A Jam report (c8700102-9423-4464-af62-3165a8d16fd5) shows a user frustrated because they cannot change the "To:" recipient when replying to an email. The scenario: Aaron (CC'd) replied instead of Walker (original lead), but the To: field still shows Walker and is read-only.

> "I cannot delete this. So then I will just have to add CC and that's additional work, that's not ideal."

### Problem Statement

1. **Phase 72 incomplete on frontend**: Backend correctly tracks `Lead.currentReplierEmail`/`currentReplierName` and `lib/email-send.ts` uses smart TO/CC resolution, but the frontend `action-station.tsx` still hardcodes `lead.email` in the To: field.

2. **No recipient editing**: The To: field is intentionally read-only (unlike CC which has delete buttons and add input). Users cannot modify recipients when the system guess is wrong.

### Technical Discovery

**Current state in `components/dashboard/action-station.tsx`:**

```tsx
// Line 98 comment: "To field (read-only)"
// Lines 816-819:
{isEmail && lead?.email && (
  <EmailRecipientEditor
    toEmail={lead.email}     // ❌ Ignores currentReplierEmail
    toName={lead.name}       // ❌ Ignores currentReplierName
    ...
  />
)}
```

**CC replier fields are available:**
- `Lead` type in `lib/mock-data.ts` includes `currentReplierEmail`, `currentReplierName`, `currentReplierSince`
- These are populated in `inbox-view.tsx` when loading conversations

**CC field implementation (reference for To: editable design):**
- Lines 106-154 show editable CC with delete buttons and add input
- Same pattern should apply to To: field

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 72 | Complete | `action-station.tsx`, `lib/email-send.ts` | Read current changes before modifying |
| Phase 73 | Active | None | Independent - no file overlap |

## Pre-Flight Conflict Check (Multi-Agent)

- [ ] Run `git status --porcelain` and confirm state of:
  - `components/dashboard/action-station.tsx` (modified - Phase 72)
  - `actions/message-actions.ts`
  - `actions/email-actions.ts`
  - `lib/email-send.ts` (modified - Phase 72)
- [ ] Re-read current file contents before implementing

## Objectives

* [x] Fix To: field to display `currentReplierEmail || lead.email` (Phase 72 bug fix)
* [x] Make To: field editable (single-select from known participants)
* [x] Update send actions to accept explicit `toEmail`/`toName` overrides (provider-safe)
* [x] Validate at least one To: recipient before sending
* [x] Verify with `npm test && npm run lint && npm run build`

## Constraints

- Must maintain backward compatibility (if user doesn't edit, use current smart resolution)
- To: field cannot be empty at send time (show warning, disable send button)
- Email threading relies on provider handles (not addresses), so changing To: won't break threading
- Keep changes minimal - don't refactor unrelated code

## Success Criteria

- [x] When a CC'd person has replied (`currentReplierEmail` set), the To: field shows their email
- [x] Users can change the To: recipient (single-select from known thread participants)
- [x] Sending with empty To: is blocked with clear feedback
- [x] Outbound emails go to the correct recipients (what user selected) for EmailBison + SmartLead
- [x] Instantly threads do not allow overriding To (API limitation); UI reflects this
- [x] `npm test`, `npm run lint`, and `npm run build` pass

## Subphase Index

* a — Fix CC replier display in To: field (Phase 72 bug fix)
* b — Make To: field editable (component changes + state management)
* c — Update send actions to accept `to` override parameter
* d — Verification and testing

## Key Files

| File | Purpose |
|------|---------|
| `components/dashboard/action-station.tsx` | Email composer UI - To: field display + editing |
| `actions/message-actions.ts` | `sendEmailMessage()` / `approveAndSendDraft()` - add `toEmail`/`toName` options |
| `actions/email-actions.ts` | Thread `toEmail`/`toName` through `sendEmailReply()` + `sendEmailReplyForLead()` |
| `lib/email-send.ts` | Apply `toEmailOverride` in `sendEmailReplySystem(...)` (provider-safe) + persist current replier post-send |
| `lib/email-participants.ts` | Pure helpers for override application + lead current-replier updates |
| `lib/instantly-api.ts` | Instantly reply payload uses `body: { text/html }` (per API docs) |
| `lib/__tests__/email-participants.test.ts` | Unit tests for the new pure helpers |

## Open Questions (Need Human Input)

None - requirements are clear from the Jam report and user feedback.

## Assumptions (Agent)

- Assumption: To is single-select (not multi-recipient). (confirmed by user)
- Assumption: If user doesn't modify To:, existing smart resolution is used (current replier when applicable). (confidence ~95%)
- Assumption: Instantly reply API does not support overriding To; we disable To overrides for Instantly threads. (confirmed via Context7 docs)

## Phase Summary

### Shipped

- `components/dashboard/action-station.tsx`
  - To: now shows `Lead.currentReplierEmail/currentReplierName` when set
  - To: is now a single-select dropdown of known participants (primary, current replier, alternates, latest inbound sender)
  - To overrides are disabled for Instantly threads (API limitation), with an inline explanation
- `actions/message-actions.ts`, `actions/email-actions.ts`
  - Email send paths accept `{ toEmail, toName }` overrides (in addition to existing CC overrides)
- `lib/email-send.ts`
  - Applies `{ toEmailOverride, toNameOverride }` to EmailBison + SmartLead sends (provider-safe)
  - Stores outbound `Message.toEmail/toName/cc` using final resolved recipients
  - Persists user-selected To as `Lead.currentReplier*` + `alternateEmails` post-send (EmailBison + SmartLead only)
- `lib/instantly-api.ts`
  - Instantly reply payload now matches API docs (`body: { text/html }`)
- Tests
  - Added unit coverage for new helper logic in `lib/__tests__/email-participants.test.ts`
  - Ensured test runner includes that file via `scripts/test-orchestrator.ts`

### Verified

- `npm test`: pass (78 tests) — Sat Jan 31 2026
- `npm run lint`: pass (warnings only) — Sat Jan 31 2026
- `npm run build`: pass — Sat Jan 31 2026
