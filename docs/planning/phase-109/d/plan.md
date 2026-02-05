# Phase 109d — Email Webhook Hardening: Strip Null Bytes (UTF8 0x00)

## Focus
Prevent inbound email ingestion from failing with `invalid byte sequence for encoding "UTF8": 0x00` by stripping null bytes from provider payload strings before writing to Postgres.

## Inputs
- Production log entry (from `logs_result (2).json`):
  - `/api/webhooks/email` → `Error [DriverAdapterError]: invalid byte sequence for encoding "UTF8": 0x00`
- Cleaning path:
  - `lib/email-cleaning.ts` → `cleanEmailBody(htmlBody, textBody)` (line 111) returns `{ cleaned, rawText, rawHtml }`
  - Now strips null bytes via `stripNullBytes(...)`
- Ingestion path:
  - `app/api/webhooks/email/route.ts` creates `Message` rows using cleaned/raw fields.

## Work
1. Add a deterministic sanitizer helper in `lib/email-cleaning.ts`:
   ```typescript
   /**
    * Strip null bytes (\u0000) from strings to prevent Postgres UTF-8 encoding errors.
    * Logs when stripping occurs for observability.
    */
   function stripNullBytes(text: string | null | undefined, fieldName?: string): string | undefined {
     if (!text) return text ?? undefined;
     const stripped = text.replace(/\u0000/g, '');
     if (stripped.length !== text.length && fieldName) {
       console.warn(`[Email Cleaning] Stripped ${text.length - stripped.length} null bytes from ${fieldName}`);
     }
     return stripped;
   }
   ```
2. Apply sanitizer in `cleanEmailBody` (line 111) to:
   - `cleaned` (before return)
   - `rawText` (before return)
   - `rawHtml` (before return)
3. **Also sanitize in the webhook route** (`app/api/webhooks/email/route.ts`):
   - `subject` field
   - `fromName` / `fromEmail` fields
   - Any other string fields written to Message/Lead records
4. Add unit tests in `lib/__tests__/email-cleaning.test.ts`:
   - Test: `cleanEmailBody` strips null bytes from all output fields
   - Test: mixed content with multiple null bytes
   - Test: empty/null input handling preserved

## Validation (RED TEAM)
- [x] Unit test: `cleanEmailBody` with input containing `\u0000` → verify output has no null bytes
- [ ] Unit test: subject sanitization in webhook (not added; covered indirectly by `cleanNullableString` + `stripNullBytes` usage)
- [ ] Manual test: send test email via webhook with null bytes in body → verify message stored successfully
- [ ] Verify webhook succeeds with null bytes in production payload (log-only)

## Output
- Email webhook no longer crashes on null bytes; messages are stored successfully.
- Code changes:
  - `lib/email-cleaning.ts` (add `stripNullBytes` helper + apply in `cleanEmailBody`)
  - `app/api/webhooks/email/route.ts` (sanitize subject and other string fields)
  - `lib/__tests__/email-cleaning.test.ts` (new tests)
  - `scripts/test-orchestrator.ts` (register new test)

## Handoff
Proceed to Phase 109e to make the UI refetch drafts when sentiment changes.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `stripNullBytes(...)` and applied it in `cleanEmailBody(...)`.
  - Sanitized critical webhook strings (`subject`, participant emails/names, cc/bcc lists, scheduled-email body html) before DB writes.
  - Added unit tests for email cleaning null-byte sanitization.
- Commands run:
  - `npm test` — pass
  - `npm run build` — pass
- Blockers:
  - Manual reproduction with a real null-byte provider payload still recommended for full confidence.
- Next concrete steps:
  - Ensure the compose UI refetches drafts on sentiment changes (109e).
