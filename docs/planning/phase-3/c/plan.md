# Phase 3c — Audit Trigger Coverage + Add Safe Backfill/Monitoring

## Focus
Ensure eligible leads actually get sent to Clay (especially LinkedIn enrichment) and add a safe mechanism to backfill leads that were missed due to prior misconfiguration.

## Inputs
- Observations: LinkedIn table last “Webhook received” on 2025-12-17; phone table last received 2026-01-02
- Trigger paths: `app/api/webhooks/email/route.ts`, `app/api/webhooks/linkedin/route.ts`, `actions/enrichment-actions.ts`, `lib/phone-enrichment.ts`

## Work
- Map where Clay triggers are initiated and what gates them:
  - Positive sentiment gating
  - One-time policy based on `Lead.enrichmentStatus`
  - Email-required constraint
  - Rate limiting
- Add lightweight observability:
  - Clear logs on “trigger skipped” with reason codes (no PII)
  - Optional admin-only “enrichment queue status” endpoint/action (counts of eligible leads)
- Add a safe backfill mechanism (if needed):
  - Manually mark eligible leads `pending` and trigger Clay in small batches
  - Cap retries using `enrichmentRetryCount` and time windows

## Output
- A clear explanation (or code change) that resolves why LinkedIn triggers went stale and a safe path to re-queue missed enrichments.

## Handoff
Use the new monitoring/backfill hooks to validate real-world traffic post-fix in Phase 3d.

