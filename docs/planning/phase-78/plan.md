# Phase 78 — Fix DB Schema Drift Errors (P2022) + Cron Resilience

## Purpose

Eliminate recurring production and preview errors caused by Prisma schema drift (P2022 “column does not exist”) and harden cron endpoints so non-critical failures don’t crash the whole function.

## Context

From `logs_result.json` (Vercel logs export around 2026-01-31):

- Core 500s:
  - `/api/cron/followups`: Prisma `P2022` “The column (not available) does not exist in the current database.”
  - `/api/webhooks/email`: Prisma `P2022` during lead lookup.
- Non-core failures:
  - `/api/cron/insights/booked-summaries`: `INTERNAL_FUNCTION_CONNECTION_ERROR` (likely transient connectivity).
  - `/api/cron/emailbison/availability-slot`: repeated `fetch failed` after retries (external dependency / network).

Decisions already made:

- **Target environments:** production + preview.
- **P2022 handling policy:** **Hybrid** — fail fast for core ingestion/cron paths, degrade gracefully for non-critical cron work.
- **Schema rollout approach:** use `db:push` (ensure it runs for prod + preview whenever `prisma/schema.prisma` changes).

## Concurrent Phases

Recent local phases exist but are currently uncommitted/untracked (`docs/planning/phase-75/`, `phase-76/`, `phase-77/`) and include edits to `lib/followup-engine.ts`, `lib/ai-drafts.ts`, and inbox rendering code.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 77 | Active (uncommitted working tree) | `lib/followup-engine.ts`, AI prompt runner | Avoid touching overlapping sections; rebase/merge carefully before deployment |
| Phase 76 | Active (uncommitted working tree) | Inbox rendering (`components/dashboard/chat-message.tsx`) | Independent from schema drift fix; keep changes isolated |
| Phase 75 | Active (uncommitted working tree) | `lib/followup-engine.ts` | Independent from schema drift fix; keep changes isolated |

## Objectives

* [x] Add a reusable DB schema compatibility utility (detect missing tables/columns; return 503 for core routes).
* [x] Gate `/api/cron/followups` and `/api/webhooks/email` with schema checks (core fail-fast behavior).
* [x] Harden non-critical cron routes to return 200 with structured errors on transient/external failures.
* [x] Document and operationalize `db:push` (prod + preview) rollout steps.
* [x] Validate with lint/build and targeted smoke checks.

## Constraints

- Webhook and cron endpoints must remain auth-guarded; do not weaken security.
- No secrets/PII committed to the repo; logs must remain safe.
- Core endpoints (email webhook, followups cron) must be **retryable** when DB is out of date (503 + clear message).
- Non-critical cron tasks should not take down the whole function; keep them resilient and observable.

## Success Criteria

- No P2022 exceptions from `/api/cron/followups` or `/api/webhooks/email` in prod/preview logs after rollout.
- When schema is missing, core routes return `503` with a JSON payload describing missing tables/columns (and do not emit noisy stack traces).
- `/api/cron/insights/booked-summaries` and `/api/cron/emailbison/availability-slot` return `200` with `{ success: false, errors: [...] }` on transient failures.
- `npm run lint` and `npm run build` pass.

## Subphase Index

* a — Inventory error signatures and code touch points
* b — Implement DB schema compatibility utility + core route gating
* c — Harden non-critical cron routes (insights + emailbison)
* d — `db:push` rollout docs (prod + preview)
* e — Verification, smoke tests, and monitoring checklist

## Phase Summary

- **Shipped:**
  - `lib/db-schema-compat.ts` — new utility for detecting missing tables/columns via `information_schema.columns`
  - Core route gating in `/api/cron/followups` and `/api/webhooks/email` — returns 503 with `Retry-After` on schema drift
  - Non-critical cron hardening in `booked-summaries` and `availability-slot` — returns 200 with structured error JSON
- **Verified:**
  - `npm run lint`: pass (0 errors)
  - `npm run build`: pass
  - `npm run db:push`: skip (no schema changes)
- **Notes:**
  - Phase 78d simplified from "Prisma migrations" to `db:push` documentation — migrations deemed unnecessary complexity for current operational needs
  - All implementation committed in `1ea27d8` alongside Phases 75-77
  - See `review.md` for detailed evidence mapping
