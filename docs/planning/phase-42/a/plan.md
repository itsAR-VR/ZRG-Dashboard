# Phase 42a — Supabase Session + Inbox Counts Auth Hardening

## Focus
Stop `refresh_token_not_found` noise and prevent “Unauthorized” inbox count errors by making server-side session handling deterministic and by treating missing/expired auth as a normal signed-out state.

## Inputs
- Vercel logs (Jan 19, 2026): `refresh_token_not_found`, “Failed to get inbox counts: Unauthorized”
- Existing auth/session utilities (`lib/supabase*`, `middleware.ts`, relevant Server Actions / API routes)
- Any existing patterns for returning safe empty-state data when unauthenticated

## Work
- Trace where refresh is attempted on the server (middleware and/or server client creation) and identify when it can run without a refresh token.
- Add guardrails so “refresh session” is only attempted when a refresh token is actually present.
- Ensure inbox counts fetch runs in the correct auth context; if unauthenticated:
  - return a safe zero-count state rather than throwing
  - avoid error-level log spam for expected auth failures
- Adjust logging so expected auth states (missing cookies, expired session) are not logged as `[error]`.

## Output
- Implemented Supabase auth error utilities to detect/normalize auth failures: `lib/supabase/error-utils.ts`.
- Hardened middleware auth flow to avoid `refresh_token_not_found` noise:
  - Fast-path skips Supabase client/network calls when no auth cookie is present.
  - Treats Supabase auth errors as a signed-out state (redirect for protected routes); only “fail open” on non-auth unexpected errors.
  - Changes in `lib/supabase/middleware.ts`.
- Prevented Supabase `AuthApiError` from surfacing as an unhandled exception in auth-gated Server Actions:
  - `lib/workspace-access.ts:requireAuthUser()` converts thrown Supabase auth errors into `Error("Not authenticated")`.
  - `actions/auth-actions.ts:getCurrentUser()` treats thrown auth errors as signed-out (no server `console.error` spam).
- Made inbox counts safe under unauth/unauthorized states (no noisy logs): `actions/lead-actions.ts:getInboxCounts()` now returns a zero-count empty-state for `Not authenticated` / `Unauthorized` without `console.error`.

## Handoff
Proceed to Phase 42b to align EmailBison error mapping with the same philosophy: auth/config failures should be actionable and non-noisy, and should never cascade into retries/timeouts.
