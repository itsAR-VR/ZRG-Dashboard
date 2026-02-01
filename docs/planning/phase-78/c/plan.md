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

Phase 78d documents `db:push` workflow for prod + preview.

## Review Notes

- Evidence:
  - `app/api/cron/insights/booked-summaries/route.ts:36-40` implements retry loop with delays [0, 250, 1000]ms
  - `app/api/cron/insights/booked-summaries/route.ts:178-183` detects transient errors (connection reset, timeout)
  - `app/api/cron/insights/booked-summaries/route.ts:192-202` returns 200 with `{ success: false, errors }`
  - `app/api/cron/emailbison/availability-slot/route.ts:43-55` wraps in try/catch, returns 200 with structured error
- Deviations: None
- Follow-ups: None
