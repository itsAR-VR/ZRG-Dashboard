# Phase 164b — Backend Stabilization (Search + Supabase Admin)

## Focus
Remove the worst latency spikes by fixing the known slow paths:
1) `%term%` lead search scans on large workspaces (especially full-email searches)
2) Supabase Admin email lookup variance (avoid paging through all users)

## Inputs
- Phase 164a scoped file list and budgets.
- Existing implementation in:
  - `actions/lead-actions.ts`
  - `lib/supabase/admin.ts`

## Work
- Inbox search:
  - Guardrail: ignore server search terms under a minimum length.
  - Fast path: detect “looks like full email” and use exact-match filters (avoid `contains`).
  - Preserve semantics for multi-term searches.
- Supabase Admin lookup:
  - Prefer `admin.getUserById` when available.
  - Add Redis cache for `userId -> email` lookups to reduce repeated calls.
  - Ensure logs contain no PII; only counts/timing.
- Observability parity for inbox read APIs:
  - Ensure `x-zrg-duration-ms` is emitted consistently (success + error + disabled).

## Output
- Backend changes ready to validate and ship.

## Handoff
Proceed to Phase 164c to ensure the frontend does not trigger expensive server paths due to short/unstable search inputs or effect churn.

