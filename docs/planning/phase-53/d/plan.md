# Phase 53d — Auth/Session + Server Action Error Hygiene (No Noise, No Abort Cascades)

## Focus
Stop recurring auth/session error spam (`refresh_token_not_found`, `AbortError`, “Unauthorized”) and ensure signed-out/stale-cookie states degrade cleanly without polluting production logs or breaking navigation.

## Inputs
- `middleware.ts` (route protection + session refresh)
- `lib/supabase/middleware.ts` (session refresh implementation)
- `lib/supabase/error-utils.ts` and `lib/workspace-access.ts` (error classification)
- Server actions emitting noisy auth errors:
  - `actions/message-actions.ts:getPendingDrafts()` (logs Unauthorized as error)
  - `actions/lead-actions.ts:getInboxCounts()` (already suppresses Unauthorized; now also needs timeout resilience)
- Observed log signatures:
  - `AuthApiError ... refresh_token_not_found` (12)
  - `DOMException [AbortError]` (4)
  - `[getPendingDrafts] ... Unauthorized` (3)

## Work
1. **Middleware: treat missing/invalid refresh as signed-out**
   - Ensure session refresh is only attempted when refresh cookie exists.
   - Catch and classify Supabase auth errors:
     - `refresh_token_not_found` → clear session cookies (if safe) and proceed as signed-out.
   - Avoid logging these as `console.error` unless there’s a real unexpected condition.

2. **AbortError handling**
   - Catch `AbortError` (undici fetch abort) in middleware/session refresh and treat as a non-fatal transient.
   - Do not spam logs for aborted navigation.

3. **Server actions: return structured unauth results**
   - For actions like `getPendingDrafts`, treat Unauthorized/Not authenticated as an expected control flow:
     - return `{ success: false, error: "Unauthorized" }` (or redirect) without `console.error`.
   - Ensure UI callers handle this deterministically (redirect to `/auth/login`).

4. **Remove debug logs from production paths**
   - Audit server actions that `console.log` potentially sensitive metadata (draft IDs, lead IDs) and either:
     - gate by environment, or
     - reduce verbosity.

## Output
- **AbortError suppression:** `lib/supabase/error-utils.ts` adds `isAbortError(...)`, and `lib/supabase/middleware.ts` now treats AbortError (middleware timeout abort) as expected control flow (no warn-level spam; fail-open).
- **Server action hygiene:** `actions/message-actions.ts:getPendingDrafts()` no longer logs per-request debug info, and returns `{ success: false, error: "Unauthorized" }` for expected unauth states instead of `console.error(...)`.
- **Refresh-token noise:** middleware already fast-paths when auth cookies are absent and treats `refresh_token_not_found` as “signed-out” control flow (no error-level logs); this subphase extends that same philosophy to aborts + server actions.

## Handoff
Proceed to Phase 53e to harden AI + background jobs (timeouts, truncation, and transaction contention).
