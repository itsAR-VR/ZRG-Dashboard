# Phase 57 — Log Taxonomy (from `logs_result.json`)

**Audit date:** 2026-01-25

## Source
- File: `logs_result.json`
- Records: 1000 (JSON array)

## Time range (UTC)
- 2026-01-25 09:05:25 → 2026-01-25 09:20:46 (≈ 15 minutes)

## High-level breakdown

### Requests by path (top)
- `GET .../api/cron/appointment-reconcile`: 995
- `GET .../api/cron/insights/booked-summaries`: 5

### Response status codes
- `200`: 1000

### Log levels
- `error`: 920
- `info`: 32
- `(empty/unspecified)`: 48

## Normalized error signatures (top)

| Count | Signature |
|------:|-----------|
| 919 | `[GHL Reconcile] Error reconciling appointment <id> for lead <uuid>: [Appointment Upsert] Missing ghlAppointmentId for GHL appointment upsert` |
| 1 | `[Insights Cron] Failed to compute booked summary: { ... Post-process error: schema violation ... objection_responses[0].agent_response too_big (>300 chars) }` |

## Notes / RED TEAM
- The cron appears to return HTTP 200 even when it logs errors; monitoring must key off logs/counters, not only status codes.
- The dominant error suggests the GHL “get appointment by id” response is not normalized to include an `id` field, causing `upsertAppointmentWithRollup(...)` to throw and preventing `appointmentLastCheckedAt` from advancing (leading to repeated retries every minute).

