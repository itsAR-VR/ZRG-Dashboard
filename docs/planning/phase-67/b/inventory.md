# Phase 67b — Error Signature Analysis

## Error Pattern Inventory

Analyzed log file: `logs_result copy.json` (from before Phase 63 deployment)

| ID | Pattern | Count | Source | Status |
|----|---------|-------|--------|--------|
| `ai_max_output_tokens` | `Post-process error: hit max_output_tokens` | 19 | `lib/ai-drafts.ts` | **Already Fixed (Phase 63)** — `console.error` removed |
| `supabase_refresh_token_not_found` | `Invalid Refresh Token: Refresh Token Not Found` | 14 | Supabase client library | **Not Actionable** — logged by @supabase/ssr internally |
| `ghl_missing_phone_number` | `Missing phone number` | 4 | `lib/ghl-api.ts` | **Already Fixed (Phase 63)** — uses `console.warn` |
| `ghl_invalid_country_calling_code` | `Invalid country calling code` | 2 | `lib/ghl-api.ts` | **Already Fixed (Phase 63)** — uses `console.warn` |
| `ghl_sms_dnd` | `DND is active for SMS` | 1 | `lib/ghl-api.ts` | **Already Fixed (Phase 63)** — uses `console.log` |
| `max_call_stack` | `Maximum call stack size exceeded` | 2 | `actions/analytics-actions.ts:243` | **Still Uses `console.error`** — needs fix |

## Analysis

### Already Fixed in Phase 63

1. **ai_max_output_tokens**: The `console.error("[AI Drafts] Primary SMS/LinkedIn generation failed:", ...)` line was removed in commit `c88943a`.

2. **GHL Errors (DND, missing phone, invalid country code)**: Lines 313-319 in `lib/ghl-api.ts` now properly downgrade these expected errors:
   - SMS DND → `console.log` (not an error, expected CRM state)
   - Missing phone/Invalid country code → `console.warn` (data issue, not system error)

### Not Actionable

**supabase_refresh_token_not_found**: The error message `[le [AuthApiError]: Invalid Refresh Token...]` is logged by the `@supabase/ssr` library's internal error handler, not by our code. Our middleware (`lib/supabase/middleware.ts`) correctly:
- Uses `isSupabaseInvalidOrMissingSessionError()` to detect these errors
- Logs at `console.warn` level when we handle them
- Clears stale auth cookies to prevent repeated failures

The library's internal logging cannot be suppressed without patching the package. This is a known issue with Supabase SSR.

### Needs Fixing

**max_call_stack (analytics)**: Line 243 in `actions/analytics-actions.ts`:
```typescript
console.error("Error calculating response time metrics:", error);
```

This should be `console.warn` with a guard to prevent large datasets from causing stack overflows.

## Remaining Work

Only **one fix** is needed:

1. **`actions/analytics-actions.ts:243`**: Change `console.error` to `console.warn` for the response time metrics calculation failure. This is a recoverable error (the function returns default metrics).

## Validation

After fix:
```bash
npm run logs:check  # Should show 0 errors for the 6 known patterns
```

Note: `supabase_refresh_token_not_found` will still appear in logs but is not actionable by our code.
