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
### CRM Table UI Implemented (MVP)

- **Analytics tab layout**
  - Added `Overview` + `CRM` tabs inside `components/dashboard/analytics-view.tsx`
  - `CRM` tab mounts a new sheet-like table component
- **CRM table component**
  - New: `components/dashboard/analytics-crm-table.tsx`
  - Renders a wide, horizontally scrollable table with the sheet headers
  - Provides filters for Campaign, Lead Category, Lead Status, and Response Mode
  - Cursor pagination with “Load more” (default page size 150)
- **Server action**
  - `getCrmSheetRows` in `actions/analytics-actions.ts`
  - Filters on campaign/category/status/response mode/date range (date range supported in API but not yet surfaced in UI)
  - Joins `LeadCrmRow` + `Lead` with safe defaults for missing fields
  - Best-effort setter email resolution via Supabase admin

### Deferred (not yet implemented)
- Date range filter UI
- Pipeline stage/value filters (schema exists but no UI yet)
- CSV export
- Row virtualization (current table is paginated but not virtualized)

## Coordination Notes

**Issue:** Another agent’s stash/pull removed the CRM upsert helper and pipeline hooks.  
**Resolution:** Recreated `lib/lead-crm-row.ts` and restored upsert calls in inbound post-process handlers so CRM rows are populated.  
**Files affected:** `lib/lead-crm-row.ts`, inbound post-process files in `lib/` and `lib/background-jobs/`.

## Handoff
Proceed to Phase 83e to update `README.md` with the CRM/pipeline/sales-call roadmap (marking skeleton-only features).
