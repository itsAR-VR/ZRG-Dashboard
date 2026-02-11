# Phase 131f — CRM Analytics Semantics Tweaks (Any vs Kept + Follow Up + Effective Mode Filter)

## Focus
Apply post-ship semantics decisions to the CRM analytics view so the numbers and filters match operator expectations:
- Show both booking metrics (booked at any point vs kept/excluding cancellations)
- Treat any `Follow Up` sentiment as “Follow-up in future”
- Make the Response Mode filter match the displayed effective mode (stored OR inferred)

## Inputs
- Phase 131 CRM analytics implementation:
  - `actions/analytics-actions.ts` (`getCrmWindowSummary`, `getCrmSheetRows`)
  - `components/dashboard/analytics-crm-table.tsx`
  - `lib/crm-sheet-utils.ts`
- User decisions (locked):
  - Show both booking metrics (Any + Kept)
  - Follow Up response type: any `Follow Up` sentiment
  - Response Mode filter: effective (stored OR inferred)

## Work
1. Booking rates (Any + Kept):
   - Extend `getCrmWindowSummary()` to return both sets of counts + rates:
     - Any: booking evidence regardless of cancellation
     - Kept: booking evidence excluding canceled (`appointmentStatus='canceled'` or `appointmentCanceledAt` set)
   - Update CRM summary UI to display both values (Kept primary, Any secondary).
2. Follow Up response type:
   - Update `deriveCrmResponseType()` and the summary SQL `CASE` to classify any `Follow Up` sentiment as `FOLLOW_UP_FUTURE`.
3. Response Mode filtering:
   - Update `getCrmSheetRows()` so filtering by `responseMode` matches the effective response mode:
     - Stored `LeadCrmRow.responseMode` when present
     - Otherwise infer from the first outbound message after interest (channel-matched)
4. Update tests:
   - Ensure unit tests reflect the updated Follow Up semantics and continue covering Objection mapping.
5. Quality gates:
   - `npm test`, `npm run lint`, `npm run build`

## Output
- CRM analytics shows both booking metrics (Any + Kept) in KPIs and breakdown tables.
- Follow Up classification matches the locked decision.
- Response Mode filter matches the displayed response mode.

## Handoff
- None (final pass: run phase-gaps and update Phase 131 review.md with evidence).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated CRM summary metrics to return and render Any vs Kept booking counts/rates.
  - Updated response-type classification so any `Follow Up` sentiment is labeled `FOLLOW_UP_FUTURE`.
  - Updated CRM response-mode filtering to match effective mode (stored OR inferred) so filters match what users see.
- Commands run:
  - npm test — pass
  - npm run lint — pass (warnings only)
  - npm run build — pass
- Blockers:
  - None
- Next concrete steps:
  - Update Phase 131 review.md to reflect the new semantics and evidence.

## Progress This Turn (Terminus Maximus) — 2026-02-10
- Work done:
  - Updated `docs/planning/phase-131/review.md` to reflect 131f semantics (Any vs Kept, Follow Up response-type semantics, effective response-mode filtering).
  - Ran Phase 131 phase-gaps RED TEAM pass and captured an open question about “Kept” semantics (canceled vs no-show).
- Commands run:
  - phase-gaps — pass (refined `docs/planning/phase-131/plan.md`)
- Blockers:
  - None
- Next concrete steps:
  - None
