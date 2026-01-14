# Phase 20d — Webhook Robustness (Idempotency, P2002 Race Handling, Response Fast-Path)

## Focus
Prevent webhook failures and Vercel timeouts by making lead/message writes idempotent, handling lead-create races (P2002), and returning responses quickly (avoiding 25s initial response / 300s max runtime failures).

## Inputs
- Vercel logs showing Prisma P2002: unique constraint failed on `Lead.ghlContactId`.
- Webhook routes (`app/api/webhooks/ghl/sms/route.ts`, `app/api/webhooks/email/route.ts`, `app/api/webhooks/linkedin/route.ts`).
- Lead matching (`lib/lead-matching.ts`).

## Work
1. Make lead creation idempotent: upsert/catch P2002 and re-fetch by unique key.
2. Add a strict time budget for webhook LLM work (draft + auto-send eval), skipping when the budget is exhausted.
3. Add route-level `maxDuration` export (900s) for webhook endpoints where Vercel supports it.
4. Harden middleware session refresh with a fetch timeout + error fallback.

## Output
- Fixed Prisma P2002 lead-create races by returning the existing lead when a concurrent create happens:
  - `lib/lead-matching.ts` catches `P2002` (unique `ghlContactId`) and re-fetches via `findUnique({ where: { ghlContactId } })`.
- Added route-level max duration exports for webhook endpoints:
  - `app/api/webhooks/ghl/sms/route.ts` (`export const maxDuration = 900;`)
  - `app/api/webhooks/email/route.ts` (`export const maxDuration = 900;`)
  - `app/api/webhooks/linkedin/route.ts` (`export const maxDuration = 900;`)
- Hardened middleware reliability and reduced hot-path latency:
  - `lib/supabase/middleware.ts` now skips session refresh for `/api/*` routes and wraps Supabase auth fetches with an abort timeout (`SUPABASE_MIDDLEWARE_TIMEOUT_MS`, default 8000ms).

## Handoff
Proceed to Phase 20e to unify EmailBison invalid sender ID healing across send paths, update README env docs (new knobs from 20a–20d), run lint/build, and push changes.
