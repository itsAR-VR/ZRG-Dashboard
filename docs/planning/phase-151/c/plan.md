# Phase 151c — Tim Canary Backfill + Global Backfill (Rollback-Safe) + LinkedIn Runtime Verification

## Focus
Correct existing data (company URLs stored in `Lead.linkedinUrl`) safely and prove LinkedIn steps/sends no longer stall for Tim before running the same cleanup globally.

## Inputs
- `docs/planning/phase-151/b/plan.md` (ingestion precedence fixed)
- Prod DB now includes `Lead.linkedinCompanyUrl`
- Tim canary workspace:
  - `clientId = 779e97c3-e7bd-4c1a-9c46-fe54310ae71f`

## Work
1. **Create rollback-safe backup table (7-day retention)**
   - Table: `_phase151_linkedin_backfill_backup`
   - Store (at minimum): `leadId`, `clientId`, `oldLinkedinUrl`, `backfilledAt`
   - Insert rows for all leads that will be updated before running updates.

2. **Tim-only backfill**
   - Target: Tim leads where `linkedinUrl ILIKE '%/company/%'`
   - Update behavior:
     - `linkedinCompanyUrl = COALESCE(linkedinCompanyUrl, linkedinUrl)`
     - `linkedinUrl = NULL`
   - Verify immediately with queries:
     - Tim: `count(*) where linkedinUrl ILIKE '%/company/%'` should be `0`
     - Tim: `count(*) where linkedinCompanyUrl ILIKE '%/company/%'` should match expected migrated rows

3. **LinkedIn runtime verification (Tim canary)**
   - Follow-ups:
     - LinkedIn steps with no profile URL must **skip & advance** (no stalling).
     - Where company URL exists, record audit/task reason and auto-trigger Clay LinkedIn enrichment (non-blocking).
   - Manual send:
     - If no `/in/…` URL exists, fail fast with clear UX error (and do not attempt Unipile).
   - Canary window: observe Tim for 24 hours.

4. **Global backfill (after Tim canary passes)**
   - Target: all leads where `linkedinUrl ILIKE '%/company/%'`
   - Same update semantics as Tim-only backfill.
   - Verify global query returns `0` company URLs remaining in `linkedinUrl`.

5. **Retention cleanup**
   - Keep `_phase151_linkedin_backfill_backup` for 7 days.
   - Drop after the observation window if no rollback is needed.

## Output
- Tim data repaired and verified; no more company URLs in `Lead.linkedinUrl`.
- Global data repaired after canary; same guarantee holds globally.
- Rollback path exists for 7 days via the backup table.

## Handoff
Proceed to 151d to ensure SMS sendability is equally deterministic (AI normalization + audit + UI banner), using Tim as ongoing canary.
