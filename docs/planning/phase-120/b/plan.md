# Phase 120b — Analytics UI Card

## Focus
Add a new Analytics card that displays booking conversion metrics for AI-drafted outbound sends, broken down by channel + disposition.

## Inputs
- Root plan: `docs/planning/phase-120/plan.md`
- Server action from Phase 120a: `getAiDraftBookingConversionStats`
- Existing Analytics view structure: `components/dashboard/analytics-view.tsx`

## Work
1. Update `components/dashboard/analytics-view.tsx`:
   - Add local state: `aiDraftBookingStats`, `aiDraftBookingLoading`
   - Fetch within the existing effect that depends on `activeWorkspace` + window:
     - Pass `{ clientId: activeWorkspace, from, to }` when windowed.
2. Render a new card under the existing **AI Draft Response Outcomes** card:
   - Title: `AI Draft Booking Conversion`
   - Description:
     - Include the current window label
     - State attribution window (30d) and pending buffer (7d)
3. Table layout (9 rows):
   - Rows: Email/SMS/LinkedIn x Auto‑Sent/Approved/Edited
   - Columns:
     - Eligible **(RED TEAM: defined as `booked + notBooked` — excludes PENDING and BOOKED_NO_TIMESTAMP)**
     - Booked
     - Booking Rate **(RED TEAM: `booked / eligible`, show `—` when `eligible === 0`; never divide by zero)**
     - Pending
     - No Timestamp
4. Ensure email rows reflect the server-side `AI_AUTO_SEND` filter (no additional UI filtering necessary).
5. Match loading/empty state conventions from the existing outcomes card.

## Output
- Updated Analytics UI to fetch + render booking conversion stats:
  - `components/dashboard/analytics-view.tsx` (new state, fetch, and `AI Draft Booking Conversion` card)

## Handoff
Phase 120c: run `npm test`, `npm run lint`, `npm run build` and record results in the phase docs.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `getAiDraftBookingConversionStats` fetch alongside existing analytics fetches.
  - Rendered a new table card broken down by channel + disposition with eligible/booked/rate/pending/no-timestamp.
- Commands run:
  - (covered in Phase 120c)
- Blockers:
  - None.
- Next concrete steps:
  - Run quality gates + document evidence (Phase 120c).
