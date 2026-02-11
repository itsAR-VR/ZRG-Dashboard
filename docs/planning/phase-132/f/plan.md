# Phase 132f — Analytics Window Correctness (Custom Dates + CRM Filters)

## Focus
Make Analytics date range selection reliable and consistent across tabs (especially CRM + Response Timing):
- Custom date ranges should respect **local-day boundaries** (date inputs)
- Window end (`to`) should behave as **exclusive** across CRM filtering and summaries

## Inputs
- Phase 132 root plan (`docs/planning/phase-132/plan.md`)
- Date window UI: `components/dashboard/analytics-view.tsx` (`datePreset`, `customFrom/customTo`, `windowParams`)
- CRM window consumers:
  - `components/dashboard/analytics-crm-table.tsx` (passes `dateFrom/dateTo`)
  - `actions/analytics-actions.ts` (`getCrmSheetRows`, `getCrmWindowSummary`)
- Response timing window consumer:
  - `actions/response-timing-analytics-actions.ts` (`resolveWindow`, `from/to` filtering)

## Work
1. Fix custom date parsing in `components/dashboard/analytics-view.tsx`:
   - Parse `YYYY-MM-DD` inputs into **local midnight** dates (not UTC-midnight string parsing)
   - Keep `windowTo` exclusive by adding +1 day to the parsed `customTo` date

2. Align CRM date range semantics in `actions/analytics-actions.ts`:
   - Treat `filters.dateTo` as **exclusive** (`< dateTo` / `lt: dateTo`)
   - Keep `filters.dateFrom` inclusive (`>= dateFrom` / `gte: dateFrom`)
   - Apply the same exclusive semantics to `booked_in_window` comparisons

3. Sanity-check response timing requirements (no code changes expected):
   - One row per lead (lead-level dedupe via earliest response per lead)
   - Filterable by channel and responder (including AI)
   - Default maturity buffer is 14 days

## Validation (RED TEAM)
- `npm test` — ensure no regressions
- `npm run build` — ensure TS compile + Next build succeeds
- `npm run lint` — ensure no lint errors (warnings acceptable)

## Output
- Updated `components/dashboard/analytics-view.tsx` to parse custom date inputs into local-midnight windows (fixes timezone drift in custom ranges).
- Updated `actions/analytics-actions.ts` CRM date filtering + booking-in-window comparisons to treat `dateTo` as exclusive.
- Verified Response Timing analytics remains lead-level and supports channel/responder filters with a 14d maturity buffer default.

## Coordination Notes
- Overlaps with Phase 131 (CRM analytics windowing). This subphase keeps `windowTo` exclusive and ensures custom date selection uses local-day boundaries, so CRM + Response Timing tabs agree on the selected window.

## Handoff
No further subphases required for this fix; ready for deploy and production verification of windowed analytics.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Fixed custom date parsing in Analytics UI (local midnight) and unified CRM window end semantics.
- Commands run:
  - `npm test` — pass (299 tests)
  - `npm run build` — pass
  - `npm run lint` — pass (warnings only)
- Blockers:
  - None
- Next concrete steps:
  - Verify in UI: pick a custom range and confirm CRM row counts + Response Timing buckets change as expected.
