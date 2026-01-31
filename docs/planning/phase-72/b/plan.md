# Phase 72b — Email Participant Utilities

## Focus

Extend the existing `lib/email-participants.ts` (Phase 50) with additional helpers needed for CC replier handling (Phase 72). These utilities will be used by webhooks, AI drafts, and email send logic.

## Inputs

- Phase 72a: Lead model now has `alternateEmails`, `currentReplierEmail`, `currentReplierName`, `currentReplierSince`
- Existing `lib/email-participants.ts` (has `normalizeEmail(email: string): string`, `sanitizeCcList`, etc.)
- Existing `normalizeEmail(email?: string | null): string | null` in `lib/lead-matching.ts` (pattern for nullable-safe normalization)

## Work

### 1. Extend `lib/email-participants.ts` (do not replace)

Add Phase 72 helpers while keeping existing exports intact:

- `normalizeOptionalEmail(email: string | null | undefined): string | null`
  - Uses existing `normalizeEmail()` when a string is present.
- `emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean`
  - Case-insensitive exact compare after normalization.
- `detectCcReplier({ leadEmail, inboundFromEmail }): { isCcReplier: boolean }`
  - Returns true when both emails are present and not equal after normalization.
- `extractFirstName(fullName: string | null | undefined): string | null`
  - Basic first-token extraction for greetings.
- `addToAlternateEmails(existing: string[], newEmail: string | null | undefined, primaryEmail: string | null | undefined): string[]`
  - Normalizes + dedupes; never adds the primary; preserves existing order.

### 2. Add Unit Tests (Optional but Recommended)

Extend the existing `lib/__tests__/email-participants.test.ts` with tests for:
- `normalizeOptionalEmail` edge cases (null/undefined/whitespace)
- `emailsMatch` with various inputs
- `detectCcReplier` scenarios
- `addToAlternateEmails` deduplication + “never include primary”

## Output

- `lib/email-participants.ts` now exports:
  - `normalizeOptionalEmail`, `emailsMatch`, `detectCcReplier`, `extractFirstName`, `addToAlternateEmails`
  - Existing exports untouched (no breaking changes)
- `lib/__tests__/email-participants.test.ts` expanded to cover new helpers

## Handoff

Utilities are ready. Phase 72c can wire CC replier detection into webhooks.
