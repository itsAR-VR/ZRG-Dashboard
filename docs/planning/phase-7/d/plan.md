# Phase 7d — Backfill Existing Leads + Observability + Regression Checks

## Focus
Repair existing leads missing phone data and add lightweight monitoring so this doesn’t regress.

## Inputs
- Existing data model (`Lead.phone`, `Lead.ghlContactId`, enrichment fields).
- Existing scripts patterns in `scripts/`.
- Sync + webhook logging patterns (PII-safe).

## Work
1. Add a backfill script (dry-run capable) that:
   - Finds leads where `ghlContactId` is set but `phone` is null
   - Fetches `GET /contacts/{contactId}` and hydrates `Lead.phone`
   - Logs counts and failures without printing phone/email
2. Add minimal observability:
   - Count how often webhook/sync had to hydrate missing fields
   - Log categories (missing payload field, GHL fetch failed, contact missing phone)
3. Add regression checks:
   - Run `npm run lint` and `npm run build`
   - Optional: a small unit test for phone normalization and hydration rule behavior

## Output
- Existing leads can be repaired in bulk, and future failures are detectable from logs/metrics.

## Handoff
Ship + monitor; if needed, iterate on field-level enrichment tracking (phone vs LinkedIn) as a follow-up phase.

