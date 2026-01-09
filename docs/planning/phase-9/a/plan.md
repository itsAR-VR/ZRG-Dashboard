# Phase 9a — Add “Unqualified” CRM Status Everywhere

## Focus
Add a new **Unqualified** option under CRM Status and ensure the change is reflected everywhere lead status is used (database, UI, filters, and any automation logic).

## Inputs
- `prisma/schema.prisma` (Lead/CRM status fields and enums, if any)
- CRM UI routes/components under `app/` (status dropdowns, lead lists, filters)
- Any status-dependent logic under `lib/` and `actions/` (follow-ups, AI gating, views)

## Work
1. Inventory current statuses and where they live:
   - DB enum vs string; UI constants; server-side validation.
2. Implement “Unqualified” as a first-class status:
   - Update Prisma schema + migrations/db push if needed.
   - Update shared status maps/types so it compiles end-to-end.
3. Ensure “Unqualified” is handled in all flows:
   - Filtering/search, bulk updates, analytics/counts.
   - Follow-up sequencing (e.g., stop/pause follow-ups for unqualified leads, if applicable).
4. Add minimal regression coverage:
   - Unit/utility tests if present; otherwise a smoke checklist for UI + API.
5. Run `npm run lint` and `npm run build`.

## Output
### Implemented
- Added `unqualified` lead status in CRM UI:
  - `components/dashboard/crm-view.tsx`
  - `components/dashboard/crm-drawer.tsx`
- Extended shared UI typing to include `unqualified`: `lib/mock-data.ts`

### Behavior Updates (Status Usage)
- Treat `unqualified` as non-actionable for attention/follow-ups/draft surfacing (manual messaging still allowed):
  - Inbox attention/draft visibility + counts updated: `actions/lead-actions.ts`
  - Follow-up enrollment/backfills skip unqualified: `actions/crm-actions.ts`, `actions/followup-actions.ts`, `lib/followup-backfill.ts`, `lib/followup-automation.ts`
  - Reactivation engine/import paths mark unqualified as `needs_review`: `lib/reactivation-engine.ts`, `actions/reactivation-actions.ts`
  - Sync-all draft regeneration skips unqualified: `actions/message-actions.ts`

### Validation Notes
- Deferred `npm run lint` / `npm run build` until end of Phase 9 to avoid repeating across subphases.

## Handoff
Proceed to Phase 9b to add hyperlink insertion/rendering for responses and sequences (calendar link insertion + safe link rendering).
 
