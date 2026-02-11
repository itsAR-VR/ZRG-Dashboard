# Phase 131c — CRM Window Summary Aggregates (Rates + Breakdown)

## Focus
Provide server-side aggregates for the CRM window so the UI can show booking rates and breakdowns (response type, AI vs Human, per-setter) without scanning the entire table client-side.

## Inputs
- Window + filters contract from Phase 131a (`CrmSheetFilters`, including `dateFrom/dateTo`).
- Response type derivation contract from Phase 131b.
- Existing CRM table server action `actions/analytics-actions.ts:getCrmSheetRows()` (used as the consistency reference, not as an implementation).

## Work
1. Add a new Server Action in `actions/analytics-actions.ts`:
   - Name: `getCrmWindowSummary({ clientId, filters })`.
   - Must be workspace-auth gated (same `getServerClient()` + workspace access pattern as `getCrmSheetRows`).
   - Return shape: `{ success: true, data: CrmWindowSummary }` or `{ success: false, error: string }`.
2. Metrics to return (all numbers, serializable):
   - `cohortLeads`: count of `LeadCrmRow` rows with `interestRegisteredAt` in window and matching filters.
   - `bookedEver`: count of cohort leads where **booking evidence exists**: `Lead.appointmentBookedAt IS NOT NULL OR Lead.ghlAppointmentId IS NOT NULL` (reuse dual-field OR pattern from setter funnel, line 1678-1681) AND `Lead.appointmentStatus != 'canceled'` (RED TEAM: exclude canceled appointments).
   - `bookedInWindow`: same as bookedEver but additionally `Lead.appointmentBookedAt` falls within the window (`>= dateFrom AND < dateTo`).
   - Rates (compute in JS after counts, guard division-by-zero):
     - `cohortConversionRate = cohortLeads > 0 ? bookedEver / cohortLeads : 0`
     - `inWindowBookingRate = cohortLeads > 0 ? bookedInWindow / cohortLeads : 0`
3. **Booking evidence specifics** (RED TEAM — critical):
   - Booking evidence lives on `Lead` model, NOT on `LeadCrmRow`. Must JOIN: `LeadCrmRow` → `Lead` (via `leadId`).
   - Fields: `Lead.appointmentBookedAt` (DateTime?), `Lead.ghlAppointmentId` (String?), `Lead.appointmentStatus` (String?).
   - Exclude canceled: `WHERE Lead.appointmentStatus IS NULL OR Lead.appointmentStatus != 'canceled'`.
   - Existing SQL CTE pattern to follow: reactivation analytics (lines 207-280) and workflow attribution (lines 71-102) in `actions/analytics-actions.ts`.
4. Breakdown sets:
   - By response type (use `deriveCrmResponseType()` from 131b — counts + bookedEver + conversion per type).
   - By response mode (AI/HUMAN/UNKNOWN) (counts + bookedEver + conversion).
   - By setter (top N, e.g. top 10) plus AI as its own row (counts + bookedEver + conversion).
5. Attribution rules (must match table):
   - Response mode: prefer `LeadCrmRow.responseMode` when present, else derive from the first outbound response message after `interestRegisteredAt` (same logic used in `getCrmSheetRows`).
   - Setter: prefer `LeadCrmRow.responseSentByUserId` when present, else derive from the same response message.
   - Resolve userId → email using existing Supabase lookup helper used in CRM rows.
6. Performance:
   - Use SQL aggregates (`COUNT`, `SUM(CASE...)`, `GROUP BY`) scoped to the window/filter set via raw SQL or Prisma `groupBy`.
   - Response type derivation is JS-side (deterministic function), so for breakdowns either: (a) compute in JS after fetching cohort rows with sentimentTag/snoozedUntil/appointmentBookedAt, or (b) use CASE WHEN in SQL to approximate. Option (a) is safer for consistency with the table.
   - Avoid loading full CrmSheetRow payloads — select only the fields needed for aggregation.

## Output
- A server action returns window-scoped booking rates + breakdowns with consistent semantics.

## Validation (RED TEAM)

- Verify: `getCrmWindowSummary()` with a narrow window returns `cohortLeads` matching `getCrmSheetRows()` row count for the same window.
- Verify: `bookedEver` does NOT count leads with `appointmentStatus = 'canceled'`.
- Verify: `bookedInWindow` is always <= `bookedEver`.
- Verify: breakdown by response type sums to `cohortLeads`.
- Verify: division-by-zero guard works when `cohortLeads = 0` (empty window returns rates of 0, not NaN/Infinity).

## Handoff
- Phase 131d will render these metrics above the CRM table and add response-type controls.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented `getCrmWindowSummary()` server action using SQL CTE aggregates for window-scoped totals + breakdowns (response type, AI vs human, per-setter).
  - Booking conversion metrics exclude canceled appointments while response-type classification can still treat any booking evidence as a “meeting request” signal.
- Commands run:
  - See Phase 131e (quality gates)
- Blockers:
  - None
- Next concrete steps:
  - None (handoff complete)
