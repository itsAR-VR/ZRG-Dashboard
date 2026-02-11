# Phase 131 — Review

## Summary
- CRM Analytics date window now scopes the CRM tab (table + summary) and custom range changes data immediately.
- CRM tab shows response type (Meeting / Info / Follow-up Future / Objection / Other), booking conversion, and setter vs AI breakdowns.
- Booking conversion is reported as **Kept** (excludes canceled) and **Any** (includes booking evidence even if later canceled), with both cohort and in-window rates for the selected period.
- Response Mode filtering matches the displayed *effective* mode (stored on `LeadCrmRow` or inferred from the first outbound reply after interest), so filters and the table stay consistent.
- Added `Objection` sentiment end-to-end (taxonomy + prompts + ingestion) so objections don’t silently fall back to `Neutral`.
- Quality gates run in the current combined working tree state: `npm test` pass, `npm run lint` pass (warnings), `npm run build` pass.

## What Shipped
- Window wiring:
  - `components/dashboard/analytics-view.tsx` passes `window` + `windowLabel` into CRM tab.
  - `components/dashboard/analytics-crm-table.tsx` merges `window.from/to` into `CrmSheetFilters.dateFrom/dateTo`.
- Response types:
  - `lib/crm-sheet-utils.ts` adds `deriveCrmResponseType()` and `Objection` sheet mapping.
  - Follow Up semantics: any `Follow Up` sentiment is classified as `FOLLOW_UP_FUTURE`.
  - `actions/analytics-actions.ts` includes `responseType` in CRM rows.
  - `components/dashboard/analytics-crm-table.tsx` adds a “Response Type” table column.
- Booking rates + attribution breakdowns:
  - `actions/analytics-actions.ts` adds `getCrmWindowSummary()` (SQL CTE aggregates) including:
    - Cohort conversion (booked ever, both Any + Kept)
    - Booked-in-window conversion (bookedAt within window, both Any + Kept)
    - Breakdown by response type, response mode (AI/HUMAN/UNKNOWN), and setter (top rows)
  - `components/dashboard/analytics-crm-table.tsx` renders KPI strip + breakdown tables.
  - `actions/analytics-actions.ts` aligns Response Mode filtering with the effective response mode for both summary and row retrieval.
- Objection sentiment:
  - `lib/sentiment-shared.ts`, `lib/ai/prompts/sentiment-classify-v1.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/sentiment.ts`, `lib/ai/prompt-registry.ts`
- Tests:
  - `lib/__tests__/crm-sheet.test.ts`

## Evidence (Repo State)
- `git status --porcelain`: dirty working tree with concurrent phase work (not isolated to Phase 131).
- `git diff --name-only`: includes Phase 131 files plus unrelated active phase changes (memory governance + response timing).

## Verification

### Commands
- `npm test` — pass (2026-02-10)
- `npm run lint` — pass (warnings only) (2026-02-10)
- `npm run build` — pass (2026-02-10)
- `npm run db:push` — skipped (Phase 131 intended schema-free; `prisma/schema.prisma` is modified in working tree by other active phases and should be pushed as part of those phases’ rollout)

### Notes
- Build surfaced and fixed a TypeScript issue in `actions/analytics-actions.ts` during this phase’s verification loop (duplicate helper + Prisma join typing).
- Next build warnings unrelated to Phase 131:
  - CSS optimization warnings for some Tailwind arbitrary values
  - `baseline-browser-mapping` stale-data warning

## Success Criteria → Evidence

1. Custom range changes CRM rows + summary without refresh.
   - Evidence: `components/dashboard/analytics-view.tsx`, `components/dashboard/analytics-crm-table.tsx`
   - Status: met
2. CRM tab shows response-type breakdown and AI vs Human breakdown for the selected window.
   - Evidence: `components/dashboard/analytics-crm-table.tsx`, `actions/analytics-actions.ts`
   - Status: met
3. CRM tab shows booking rates (cohort conversion and in-window rate) for the selected window.
   - Evidence: `actions/analytics-actions.ts:getCrmWindowSummary()`, `components/dashboard/analytics-crm-table.tsx`
   - Status: met
4. Setter vs AI breakdown is visible and matches response-mode attribution logic.
   - Evidence: `actions/analytics-actions.ts:getCrmWindowSummary()` (effective response mode derived from stored mode or first outbound message after interest)
   - Status: met
5. Quality gates pass (`npm test`, `npm run lint`, `npm run build`).
   - Evidence: command results above
   - Status: met

## Plan Adherence
- Planned vs implemented deltas:
  - Booking outcomes: report both Any and Kept conversions so operators can reason about “booked evidence” vs “not canceled” outcomes without losing either view.
  - Response-type classification remains booking-evidence driven for meeting intent (so “Meeting request” stays stable even if later canceled).
  - Summary response-type breakdown: implemented as SQL `CASE` to avoid fetching full cohorts client-side; logic matches `deriveCrmResponseType()` taxonomy.

## Risks / Rollback
- Risk: `Objection` sentiment increases label surface area; if misclassification spikes, treat as prompt-tuning (prompt registry + classifier prompt).
- Risk: “Kept” semantics may need to expand beyond cancellations (e.g., treat `no_show` separately); the current implementation defines Kept as “not canceled”.
- Rollback lever: if you want only one conversion number, keep `Kept` and hide `Any` in `components/dashboard/analytics-crm-table.tsx` (the SQL already returns both, so you can tweak presentation without reworking aggregates).

## Follow-ups
- Consider making “Kept vs Any” a toggle (instead of “Kept primary, Any secondary”) if operators prefer one consistent primary metric.
- Consider adding small inline definitions/tooltips for:
  - Cohort conversion vs booked-in-window
  - How “setter attribution” is computed when CRM row doesn’t have an explicit setter field
  - What counts as “effective response mode” (stored on row vs inferred from first outbound)
