# Phase 4c — Verification + Operational Checklist

## Focus
Verify attribution correctness for both new ingestion and historical backfill, and provide an operator checklist to reduce regression risk.

## Inputs
- Workspace IDs for Owen + Uday 18th (Client IDs in Prisma)
- Access to logs (local or Vercel) and DB (Prisma/Studio)
- Test endpoint: `app/api/webhooks/ghl/test/route.ts`

## Work
1. **Baseline counts (before)**
   - Record unattributed counts:
     - `lead.count({ where: { clientId, smsCampaignId: null } })`
   - Record top existing `SmsCampaign` distribution:
     - group by `smsCampaignId` for a quick sanity check.

2. **New-ingestion verification**
   - Send a synthetic webhook payload matching Uday 18th’s real shape.
   - Confirm:
     - `SmsCampaign` created/updated
     - `Lead.smsCampaignId` set
     - The label appears in the UI filter list (workspace view)

3. **Backfill verification (dry-run)**
   - Run backfill with `--dry-run` + small limit.
   - Spot-check 10 leads:
     - chosen label matches expected
     - no overwrites of existing attribution

4. **Backfill verification (apply)**
   - Run backfill with `--apply`.
   - Recompute unattributed counts and confirm they drop.

5. **Regression checks**
   - Confirm that workspaces without a label still ingest leads as unattributed (expected) without errors.
   - Confirm that a lead with an existing `smsCampaignId` is not overwritten by later inbound messages.

## Output
- Quantitative before/after counts per workspace.
- A short spot-check list validating label correctness.

## Handoff
Proceed to Phase 4d rollout steps (deploy + backfill run + post-rollout dashboard checks).
