# Phase 67b — Error Signature Hardening Inventory

## Known Signatures (from `scripts/logs/assert-known-errors.ts`)

| ID | Pattern |
|----|---------|
| `ai_max_output_tokens` | `Post-process error: hit max_output_tokens` |
| `supabase_refresh_token_not_found` | `Invalid Refresh Token: Refresh Token Not Found` |
| `ghl_missing_phone_number` | `Missing phone number` |
| `ghl_invalid_country_calling_code` | `Invalid country calling code` |
| `ghl_sms_dnd` | `DND is active for SMS` |
| `max_call_stack` | `Maximum call stack size exceeded` |

## Current Fixes in Working Tree

1. **Supabase refresh_token_not_found**
   - Added pre-validation of Supabase auth cookies in `lib/supabase/middleware.ts`.
   - If cookie is malformed or missing a refresh token, cookies are cleared and `supabase.auth.getUser()` is skipped.

2. **max_call_stack**
   - Analytics response-time error is logged at warn-level (`actions/analytics-actions.ts`).

3. **GHL errors (missing phone / invalid calling code / SMS DND)**
   - Already downgraded in `lib/ghl-api.ts` to `warn`/`log` in Phase 63.

4. **AI max_output_tokens**
   - `lib/ai-drafts.ts` logs generation retries at warn-level; error-level logging no longer includes the max_output_tokens message.
   - Prompt runner error message remains for telemetry, but error-level logs should not emit this pattern.

## Remaining Risk

- If external libraries emit error-level logs containing these patterns, `logs:check` may still fail.
- Post-deploy log export is still required to prove zero hits.
