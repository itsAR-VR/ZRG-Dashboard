# Phase 78c — Harden non-critical cron routes (insights + emailbison)

## Focus

Ensure transient platform connectivity issues and external dependency failures do not crash cron handlers and instead produce observable, structured error responses.

## Inputs

- Phase 78a error groups for:
  - `/api/cron/insights/booked-summaries`
  - `/api/cron/emailbison/availability-slot`

## Work

- `booked-summaries`:
  - Add retry/backoff for transient connection errors
  - Return 200 with `{ success: false, errors: [...] }` when failures remain
- `availability-slot`:
  - Ensure fetch retry failures return 200 with structured errors (include campaign/client context)
  - Avoid throwing past the handler boundary

## Output

- Non-critical cron routes are resilient and stop generating 500s for transient failures.

## Handoff

Phase 78d introduces Prisma migrations to remove the root schema drift cause across prod + preview.

