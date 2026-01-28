# Phase 67 — Red-Team Review

## Summary
Focus on direct-to-prod release risks: error signature regression, auth-session noise, auto-send safety, auto-booking target drift, and migration safety.

## Findings + Mitigations

1. **Auth cookie corruption → refresh_token_not_found noise**
   - **Risk:** Supabase refresh attempts can still emit error-level logs if malformed cookies are passed to `supabase.auth.getUser()`.
   - **Mitigation:** Pre-validate cookie payload and refresh token in `lib/supabase/middleware.ts`; clear invalid cookies and skip `getUser()`.
   - **Status:** Implemented.

2. **AI max_output_tokens errors in error-level logs**
   - **Risk:** Incomplete output could surface at error level and trigger logs:check.
   - **Mitigation:** Ensure incomplete outputs are handled with retries and warning-level logs only; avoid `console.error` for recoverable draft failures.
   - **Status:** Partially mitigated; requires post-deploy log check.

3. **Auto-send blast risk**
   - **Risk:** Misconfiguration could allow unintended auto-sends at scale.
   - **Mitigation:** Global kill-switch (`AUTO_SEND_DISABLED=1`), threshold gating per campaign, Slack review path for low-confidence.
   - **Status:** Implemented; smoke test required.

4. **Auto-book target drift**
   - **Risk:** Booking a slot from the wrong availability source (DEFAULT vs DIRECT_BOOK).
   - **Mitigation:** `AvailabilitySource` carried end-to-end; booking uses the slot’s source; deterministic fallback in `booking-target-selector`.
   - **Status:** Implemented; smoke test required.

5. **Migration safety**
   - **Risk:** Phase 66 migration could alter follow-up sequences without rollback.
   - **Mitigation:** Canary-first migration + rollback artifact; explicit verification queries after apply.
   - **Status:** Pending execution.

## Release Blockers (must pass before prod)

- Production log export passes `npm run logs:check` with **0 hits**.
- Phase 66 migration executed (canary + full) with rollback artifact captured.
- AI auto-send + auto-book smoke tests executed in prod.
