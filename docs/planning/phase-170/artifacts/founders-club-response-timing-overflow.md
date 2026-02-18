# Founders Club Response-Timing 500 Root Cause (2026-02-18)

Workspace:
- `clientId=ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
- `name=Founders Club`

## Data Shape Snapshot

- Leads: `609,839`
- Messages: `1,255,023`
- ResponseTimingEvent rows: `6,865`
- ResponseTimingEvent window coverage:
  - `min(inboundSentAt)=2025-11-20 07:06:55`
  - `max(inboundSentAt)=2026-02-18 04:52:15`

## Deterministic Failure Repro

When running the same AI drift computation used by `getResponseTimingAnalytics`, production SQL fails with:

- `ERROR: integer out of range`

Failing expression (pre-fix):
- `(extract(epoch from (ai_response_sent_at - ai_scheduled_run_at)) * 1000)::int as drift_ms`

## Why It Failed

Founders Club contains long-delay AI response outliers. Measured after switching to `bigint`:

- `max_drift_ms=1770316499000` (well above 32-bit integer max `2,147,483,647`)

Any record above ~24.8 days of drift overflows `int` and aborts the full query, causing endpoint-level `500`.

## Code Fix

File:
- `actions/response-timing-analytics-actions.ts`

Changes:
- `::int` → `::bigint` for `drift_ms`.
- Added explicit interactive transaction budget:
  - `{ timeout: 15000, maxWait: 5000 }`

## Guardrails Added

File:
- `lib/__tests__/response-timing-analytics-guards.test.ts`

Checks:
- Drift cast remains `bigint`.
- Interactive transaction timeout options remain explicit.
