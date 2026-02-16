# Phase 158c — AI Draft Booking Conversion Stats Fix

## Focus
Fix `getAiDraftBookingConversionStats` so it no longer fails with Postgres `42883` (`timestamp without time zone >= interval`) and returns correct bucket outcomes.

## Inputs
- Phase 158a issue inventory.
- Code touch points:
  - `actions/ai-draft-response-analytics-actions.ts:getAiDraftBookingConversionStats`
  - `app/api/analytics/campaigns/route.ts` (consumes the action)
  - Existing regression test: `lib/__tests__/ai-draft-booking-conversion-windowing.test.ts`

## Work
- Fix timestamp/interval comparison type inference:
  - Prefer computing the maturity cutoff timestamp in JS (`to - maturityBufferDays`) and passing it as a `Date` parameter, avoiding SQL interval math on a parameter with ambiguous type.
  - Alternatively, explicitly cast `${to}` and `${maturityBufferDays}` inside SQL (only if Prisma parameter typing is reliable in this context).
- Add/extend a regression test to exercise the maturity-buffer “PENDING” branch so the query cannot regress silently.

## Validation (RED TEAM)
- `node --import tsx --test lib/__tests__/ai-draft-booking-conversion-windowing.test.ts`
- Confirm source no longer contains `${to} - (${maturityBufferDays} * interval '1 day')`.

## Output
- `actions/ai-draft-response-analytics-actions.ts:getAiDraftBookingConversionStats` now computes `maturityCutoff` in JS and binds that timestamp directly in SQL (`b.sent_at >= ${maturityCutoff}`), removing the ambiguous timestamp-vs-interval comparison path.
- Existing windowing behavior remains anchored to outbound `Message.sentAt` via `draft_send_time`, with lead-level dedupe maintained.
- Regression coverage updated in `lib/__tests__/ai-draft-booking-conversion-windowing.test.ts` to assert:
  - `maturityCutoff` precomputation exists,
  - interval math on `${to}` is not used in SQL,
  - send-time anchoring and lead-level aggregation remain intact.

## Handoff
Proceed to Phase 158d to address the high-volume server action drift warnings (or document why they are expected).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Confirmed booking conversion query now avoids the `timestamp >= interval` anti-pattern seen in logs.
  - Validated query-shape regression guards for windowing/dedupe/maturity logic.
- Commands run:
  - `nl -ba actions/ai-draft-response-analytics-actions.ts` — pass; `maturityCutoff` path present.
  - `node --import tsx --test lib/__tests__/ai-draft-booking-conversion-windowing.test.ts` — pass.
- Blockers:
  - Production log confirmation still pending deploy + follow-up export.
- Next concrete steps:
  - Close 158d with server-action drift decision + mitigation.
  - Package full validation + replay evidence in 158e.
