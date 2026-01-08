# Phase 4d — Rollout Plan

## Focus
Deploy the ingestion fix safely and execute the backfill with minimal risk.

## Steps
1. **Deploy ingestion fix**
   - Merge and deploy webhook extraction changes.
   - Confirm logs show label extraction for a real inbound message from Uday 18th.

2. **Backfill execution**
   - Run the backfill script:
     - first with `--dry-run` (small limit)
     - then with `--apply` (full run, rate-limited)
   - If running against production DB, ensure correct `DATABASE_URL`/`DIRECT_URL` usage per repo conventions.

3. **Post-rollout checks**
   - Verify unattributed counts decreased for Owen + Uday 18th.
   - Verify new sub-client labels appear in the dashboard filter list.
   - Spot-check several known leads (including “Rick Carlson”) for correct attribution.

## Rollback
- Ingestion fix rollback: revert the webhook extraction changes (no schema changes expected).
- Backfill rollback: if incorrect assignments occur, re-run a corrective script to set `smsCampaignId` back to null (only for affected leads), then re-apply with corrected extraction rules.
