# Phase 117d — Production Readiness Sweep (Env, Cron/Webhooks Auth, Smoke Checklist)

## Focus
Do a final “launch hardening” pass beyond the immediate inbox blocker: confirm env vars, verify cron/webhook auth patterns, and produce a concrete smoke checklist that matches how the system is actually triggered in production.

## Inputs
- `README.md` (env + deployment notes)
- `vercel.json` (cron schedules)
- Cron routes:
  - `app/api/cron/**`
- Webhook routes:
  - `app/api/webhooks/**`
- Admin provisioning:
  - `app/api/admin/workspaces/route.ts`
- Auth middleware:
  - `middleware.ts`, `lib/supabase/middleware.ts`

## Work
1. Environment variable audit (launch-blocking)
   - Verify required env vars are present in Vercel Production and locally for builds:
     - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - DB: `DATABASE_URL`, `DIRECT_URL`
     - AI: `OPENAI_API_KEY`
     - Cron: `CRON_SECRET`
     - Admin provisioning: `WORKSPACE_PROVISIONING_SECRET`
     - Public URL: `NEXT_PUBLIC_APP_URL` (required in production; used for internal links + webhook callback URLs)
   - Confirm Phase 116 rollout levers exist and defaults are safe:
     - `AUTO_SEND_DISABLED`
     - `AUTO_SEND_REVISION_DISABLED`
   - Server Actions origin hardening (RT-7):
     - We will use a custom domain in the future, so do not rely on the current `*.vercel.app` hostname.
     - Configure `experimental.serverActions.allowedOrigins` in `next.config.mjs` via an env-driven allowlist (no wildcard allow-all).
     - Default behavior should remain safe:
       - if no allowlist env var is set, keep same-origin only.
       - if allowlist is set, include both current prod domain and future custom domain(s).
     - Proposed env var:
       - `SERVER_ACTIONS_ALLOWED_ORIGINS` = comma-separated list of allowed origin domains (e.g. `app.codex.ai,cold2close.ai,*.cold2close.ai,zrg-dashboard.vercel.app`).
     - Implementation detail (decision-complete):
       - In `next.config.mjs`, build `allowedOrigins` by:
         - taking `SERVER_ACTIONS_ALLOWED_ORIGINS` (if set) split/trim into an array, and
         - optionally appending hostnames derived from `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` if present and not already included.
     - Status:
       - Implemented in `next.config.mjs` with a safe default (same-origin only when env is unset). This subphase must now ensure Production env vars match the intended domains.

2. Cron endpoint auth verification
   - For every route in `vercel.json`, ensure the handler:
     - validates `Authorization: Bearer <CRON_SECRET>` before doing work
     - returns 401 on missing/invalid auth
     - prevents overlap where needed (advisory lock pattern)

3. Webhook endpoint input hygiene
   - Confirm webhook routes validate payload shape, dedupe on platform IDs, and do not throw on repeats.
   - Confirm no webhook route logs raw inbound content at error level.
   - **RT-5: Calendly webhook signature verification must be enforced in production.**
     - File: `app/api/webhooks/calendly/[clientId]/route.ts`
     - Policy (user-confirmed): signing keys are required in production; requests with missing/invalid signatures are rejected.
     - Risk addressed: forged events creating `Appointment` records + triggering follow-up automation side effects.
   - Verified ✅: GHL SMS (location-ID based), LinkedIn (Unipile secret), SmartLead (multi-layered Bearer + header + payload), Instantly (Bearer + header), Email (workspace + HMAC) all validate auth properly.

4. Smoke checklist (minimum viable)
   - Local (must pass):
     - `npm run typecheck`
     - `npm test`
     - `npm run lint`
     - `npm run build`
   - Production (manual, but explicit):
     - Login works (no redirect loop)
     - Master Inbox loads conversations (Phase 117 fix validated)
     - Cron endpoints return success with `CRON_SECRET` and 401 without
     - A test inbound webhook inserts a Message row (in a safe dev/staging workspace)

## Planned Output
- A launch-ready checklist and an env/crons/webhooks audit note (what was verified, what remains manual).

## Planned Handoff
- Phase 117e folds these checks into an explicit deploy/rollback runbook and monitoring plan.

## Output

## Handoff

## Progress This Turn (Terminus Maximus)
- Work done:
  - Ran the local smoke suite for launch readiness (`typecheck`, `test`, `lint`, `build`).
  - Implemented env-driven Server Actions origin allowlisting for future custom domains in `next.config.mjs` (safe default when unset).
- Commands run:
  - `npm run typecheck` — pass
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - Production env audit + manual smoke tests are still pending (requires Vercel env + live app access).
- Next concrete steps:
  - Verify Production env vars include `SERVER_ACTIONS_ALLOWED_ORIGINS` (if needed for custom domains) and all required secrets (`CRON_SECRET`, `WORKSPACE_PROVISIONING_SECRET`, etc).
  - Run the production smoke list exactly as written (login, inbox load, cron auth, webhook ingestion in a safe workspace).
