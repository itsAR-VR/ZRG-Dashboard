# Phase 73a — Canonical Variable Registry + Strict Template Parsing

## Focus

Create a single source of truth for follow-up template variables (supported tokens + sources), and implement strict parsing/rendering helpers that:
- detect unknown variables (to block saves)
- detect missing referenced values (to block sends)
- never introduce defaults/placeholders

## Inputs

- Current substitution block in `lib/followup-engine.ts` (inside `generateFollowUpMessage()`).
- Existing test patterns:
  - `lib/__tests__/email-participants.test.ts` (simple `test(...)`)
  - `lib/__tests__/emailbison-stop-future-emails.test.ts` (`describe/it` + `mock.method(...)`)
- Constraint: `lib/prisma.ts` requires `DATABASE_URL` at import-time, so unit tests should not import `lib/followup-engine.ts`.

## Work

### Step 1 — Create a client-safe registry + parsing helpers

**File:** `lib/followup-template.ts` (new)

Hard constraint: no Prisma import, no server-only import. This file must be safe to import from client UI (for inline template warnings).

Implement:
- `FOLLOWUP_TEMPLATE_TOKENS`: canonical list/set of supported tokens (including aliases)
- `extractFollowUpTemplateTokens(template: string | null): string[]`
  - Extract unique tokens from `{...}` and `{{...}}` formats, preserving original token strings (e.g., `{firstName}`, `{{contact.first_name}}`)
- `getUnknownFollowUpTemplateTokens(template: string | null): string[]`
  - Uses `FOLLOWUP_TEMPLATE_TOKENS`
- `parseQualificationQuestions(json: string | null): Array<{ id: string; question: string }>` (pure)
- `applyFollowUpTemplateVariablesStrict(template: string | null, vars: { ... }): { rendered: string; missing: string[] }`
  - If a token is present in the template but the corresponding value is missing/empty, do NOT substitute a placeholder; return the missing token(s) in `missing`.
  - `rendered` can still return a best-effort string for preview/debug, but must not be used for sends if `missing.length > 0`.

`vars` should include only what substitution needs (and allow nulls):
- lead: `firstName`, `lastName`, `email`, `phone`, `leadCompanyName`
- workspace: `aiPersonaName`, `companyName`, `targetResult`, `qualificationQuestionsJson`
- booking: `bookingLink`
- availability: `availabilityText`, `slotOption1`, `slotOption2`

### Step 2 — Unit tests for parsing + missing detection

**File:** `lib/__tests__/followup-template.test.ts` (new)

Cover at minimum:
- Token extraction works for:
  - `{firstName}` / `{FIRST_NAME}` / `{FIRST\_NAME}`
  - `{leadCompanyName}`
  - `{{contact.first_name}}` / `{{contact.first\_name}}`
  - spaced tokens like `{achieving result}` and `{qualification question 1}`
- Unknown tokens are detected (e.g., `{first_name}`) and listed for save-time blocking.
- Missing referenced values are detected (no defaults):
  - template includes `{companyName}` but `companyName` is empty → missing includes `{companyName}`
  - template includes `{leadCompanyName}` but `leadCompanyName` is empty → missing includes `{leadCompanyName}`
  - template includes `{calendarLink}` but `bookingLink` is null → missing includes `{calendarLink}`
  - template includes `{qualificationQuestion1}` but qualificationQuestions are empty → missing includes `{qualificationQuestion1}`
- Empty template → empty string
- Multiple occurrences replaced globally
  - and missing includes the token once (deduped list)

## Output

- New: `lib/followup-template.ts` with canonical token registry (incl. `{leadCompanyName}`), strict token extraction, unknown-token detection, and no-placeholder rendering.
- New: `lib/__tests__/followup-template.test.ts` covering extraction, unknown tokens, missing-variable detection, and multi-occurrence replacement.

## Handoff

Phase 73b wires save-time validation + activation gating in `actions/followup-sequence-actions.ts` using the new registry/helpers.
