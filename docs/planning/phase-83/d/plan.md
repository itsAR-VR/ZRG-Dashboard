# Phase 83d — Analytics UI Plan (Spreadsheet Table)

## Focus
Design the in-app Google Sheet replica in the **Analytics** tab: a spreadsheet-like CRM table with filtering, export, and performance guardrails.

## Inputs
- Phase 83a replica spec (columns + formulas)
- Phase 83b schema plan (what’s stored vs computed)
- Existing Analytics container: `components/dashboard/analytics-view.tsx`

## Work
- UX structure:
  - Add an Analytics sub-nav (e.g., `Tabs`): `Overview` (current) + `CRM`
  - `CRM` tab shows a wide table with sticky header and horizontal scroll
- Data fetching:
  - New server action to fetch “CRM rows” with cursor pagination (avoid loading everything)
  - Filters: date range, campaign, interest type, pipeline stage, response mode, score ranges
- Performance:
  - Virtualized rows (borrow approach from `components/dashboard/crm-view.tsx`)
  - Avoid N+1 joins; select only needed fields
- Export:
  - CSV export of current filtered view (no hidden PII beyond what the UI already displays)

## Output
- UI spec: components to add/modify, query shape, and a list of filters/columns for MVP.

## Handoff
After schema + automation exist, implement the UI in small PRs: tab scaffolding → table read-only → filters → export.

