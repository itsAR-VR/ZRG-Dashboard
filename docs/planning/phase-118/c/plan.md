# Phase 118c — Custom Domain Readiness (Server Actions Allowlist + Docs)

## Focus
Ensure Server Actions continue to work when the app is accessed via a future custom domain, without relaxing security defaults.

## Inputs
- `next.config.mjs` (Server Actions allowedOrigins config)
- Phase 117 decisions: “custom domain planned”

## Work
1. Confirm allowlisting behavior (decision-complete)
   - Default: if `SERVER_ACTIONS_ALLOWED_ORIGINS` is unset AND no URL-derived hostnames are present, Server Actions remain same-origin only.
   - Note: in Vercel, `VERCEL_URL` is typically present, so the config may include that hostname automatically. This should not broaden access in single-domain setups (it matches the host), but it keeps multi-domain cutovers explicit and controlled.
   - When a custom domain is introduced, set:
     - `SERVER_ACTIONS_ALLOWED_ORIGINS` = comma-separated hostnames (and optional wildcards), e.g.:
       - `app.codex.ai,cold2close.ai,*.cold2close.ai,zrg-dashboard.vercel.app`
     - Also ensure `NEXT_PUBLIC_APP_URL` is set to the canonical production URL (e.g., `https://app.codex.ai`) so generated links + webhook callback URLs use the right hostname.
   - Keep allowlist explicit (no `*` / allow-all).

2. Documentation (repo)
   - Update launch docs (Phase 117d/e or README) to include:
     - why the env var is needed
     - exact format (hostnames + `*.example.com` wildcards)
     - examples for “Vercel domain only” vs “Vercel + custom domain”

3. Production configuration (when ready)
   - Set the env var in Vercel Production before/when switching DNS.
   - Verify Server Actions still work from both domains during cutover.

## Output
- A decision-complete, documented policy for Server Actions origins that supports future custom domains safely.

## Handoff
- Proceed to Phase 118d for cron/webhook security audit and launch-blocker closure.
