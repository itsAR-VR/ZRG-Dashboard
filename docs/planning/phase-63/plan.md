# Phase 63 — Eliminate Current Production Errors (Auth, Analytics, GHL, AI Drafts)

## Purpose
Eliminate the recurring production errors surfaced in `logs_result copy.json` (Jan 26–27, 2026) and `logs_result.json` (Jan 25, 2026) by fixing root causes across auth session handling, analytics query strategy, GHL phone normalization + error classification, appointment reconciliation normalization, and AI draft generation reliability.

## Context
Primary error signatures observed:

1) **AI Drafts (cron background jobs)**
- `Post-process error: hit max_output_tokens (incomplete=max_output_tokens output_types=reasoning)`
- Email fallback timeouts leading to deterministic fallback drafts.

2) **Auth session noise**
- `AuthApiError ... refresh_token_not_found` on `/` and `/auth/login` (stale Supabase auth cookies).

3) **Analytics failures**
- `DriverAdapterError: bind message has ... parameter formats but 0 parameters`
- `RangeError: Maximum call stack size exceeded`
These correlate with large workspace scopes being materialized into huge `IN (...)` filters and passed into Prisma queries.

4) **GHL send/update failures**
- DND active for SMS (expected business condition)
- Missing phone number (expected data condition)
- Invalid country calling code (bad phone normalization / incorrect E.164 inference)

5) **GHL appointment reconciliation**
- `Missing ghlAppointmentId for GHL appointment upsert` during `/api/cron/appointment-reconcile` due to unnormalized appointment list responses.

## Objectives
* [x] Add a log-check script to prevent regressions
* [x] Clear invalid Supabase auth cookies to stop repeated refresh attempts
* [x] Remove large `clientIds` arrays from analytics queries (relational/SQL scoping)
* [x] Make GHL phone normalization global-safe (validate before sending; AI-assisted inference only when enabled)
* [x] Reclassify expected GHL 4xx failures to non-error logs
* [x] Normalize GHL appointment list responses to ensure `id` exists (fix reconcile cron)
* [x] Improve AI draft retry behavior and reduce misleading error logs

## Constraints
- Never log PII (phones/emails) beyond existing redaction patterns.
- Do not “fix” by suppressing logs without changing behavior (cookie clearing, validation, query strategy).
- Keep client bundle lean (phone parsing libs must remain server-only).

## Success Criteria
- [x] `refresh_token_not_found` no longer appears as `level=error` in production logs for normal signed-out navigation. (verify post-deploy)
- [x] Analytics no longer emits Prisma driver/stack errors for large workspace scopes. (verify post-deploy)
- [x] GHL phone sync no longer produces `Invalid country calling code` for normal flows; invalid/ambiguous numbers are rejected safely. (verify post-deploy)
- [x] GHL DND / missing-phone conditions do not emit `console.error` from `lib/ghl-api.ts`. (verify post-deploy)
- [x] Appointment reconcile cron no longer fails with missing `ghlAppointmentId` when appointments exist. (verify post-deploy)
- [x] AI drafts stop spamming error logs for recoverable “incomplete output” states; retries are centralized. (verify post-deploy)
- [x] `npm run lint` passes.
- [x] `npm run build` passes.
- [x] `npm test` passes.

## Subphase Index
* a — Tooling: add logs regression check
* b — Auth: clear invalid Supabase cookies in middleware
* c — Analytics: relational scoping + SQL aggregation for response times
* d — GHL: phone normalization (global-safe + optional AI) + error classification + appointment list normalization
* e — AI Drafts: centralized retries and reduced noisy logs
* f — Validation: tests + runbook + phase summary

## Phase Summary
- Added log regression scanner: `scripts/logs/assert-known-errors.ts` (`npm run logs:check`)
- Cleared invalid Supabase cookies on auth refresh failures: `lib/supabase/middleware.ts`
- Reworked analytics to avoid huge scopes + stack errors: `actions/analytics-actions.ts`, `lib/workspace-access-filters.ts`
- Hardened global phone handling (E.164 validation + optional GPT-5-mini low-reasoning region inference behind env flag): `lib/phone-normalization.ts`, `lib/phone-utils.ts`
- Normalized GHL appointment list shapes + downgraded expected 4xx logging: `lib/ghl-api.ts`
- Centralized AI draft retry logic and reduced noisy “max_output_tokens” error logs: `lib/ai-drafts.ts`, `lib/ai/prompt-runner/*`
- Added post-deploy verification steps: `docs/planning/phase-63/runbook.md`
