# Phase 78a — Inventory error signatures and code touch points

## Focus

Confirm the exact error signatures and which handlers/functions are responsible so fixes target root causes without broad refactors.

## Inputs

- `logs_result.json` (Vercel logs export)
- Existing code paths:
  - `app/api/cron/followups/route.ts`
  - `app/api/webhooks/email/route.ts`
  - `app/api/cron/insights/booked-summaries/route.ts`
  - `app/api/cron/emailbison/availability-slot/route.ts`

## Work

- Parse `logs_result.json` and group errors by:
  - requestPath/function
  - Prisma code (P2022/P2021)
  - external `fetch failed` errors
  - platform connectivity errors
- Map each error group to the responsible handler and downstream lib calls.
- Confirm which Prisma models/fields are accessed in the failing paths (for schema requirements list).

## Output

- A short “Error → Owner code path” matrix for Phase 78b/78c to implement against.

## Handoff

Phase 78b implements schema compatibility gating for the core paths using the verified field requirements from this subphase.

## Review Notes

- Evidence: Error signatures analyzed from `logs_result.json`; P2022 errors confirmed in followups/email routes, transient errors in insights/emailbison routes
- Deviations: None
- Follow-ups: None
