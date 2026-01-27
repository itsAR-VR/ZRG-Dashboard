# Phase 63b — Auth: Clear Invalid Supabase Cookies in Middleware

## Focus
Stop repeated `refresh_token_not_found` errors by clearing stale Supabase auth cookies when detected.

## Inputs
- `lib/supabase/middleware.ts`
- `lib/supabase/error-utils.ts`

## Work
- [ ] Identify Supabase auth cookie names for the current project.
- [ ] When `supabase.auth.getUser()` returns/throws an invalid session error, clear auth cookies on the response.
- [ ] Ensure protected-route redirects still work; public auth routes remain accessible.

## Output
- Updated `lib/supabase/middleware.ts` to detect invalid/missing session errors (e.g. `refresh_token_not_found`) and clear Supabase auth cookies on the response.
- Cookie clearing is applied consistently to both `NextResponse.next()` and redirect responses, preventing repeated refresh attempts on subsequent requests.

## Handoff
Proceed to Phase 63c to refactor analytics to avoid materializing large `clientIds` arrays and to move response-time aggregation into SQL.
