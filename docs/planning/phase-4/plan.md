# Phase 4 — SMS Sub-Client Attribution (Auto-Create + Backfill)

## Purpose
Ensure inbound SMS leads arriving via GoHighLevel are correctly attributed to an **SMS sub-client** inside a workspace (stored as `SmsCampaign` and linked via `Lead.smsCampaignId`), even when the sub-client label has never been seen before.

## Context
- Inbound SMS webhooks for GHL are handled by `app/api/webhooks/ghl/sms/route.ts`.
- The dashboard treats `Lead.smsCampaignId = null` as **“unattributed”**.
- Some workspaces (notably **Uday 18th**) are sending a sub-client label (e.g., “Rick Carlson”) in the webhook payload, but it is not being extracted/linked, leaving leads unattributed.

## Objectives
- [ ] For new inbound SMS leads, extract the sub-client label from the webhook payload reliably.
- [ ] If the sub-client label does not exist for the workspace, auto-create the `SmsCampaign` record.
- [ ] Set `Lead.smsCampaignId` for new leads and for existing matched leads when currently null.
- [ ] Backfill historical unattributed leads (Owen + Uday 18th) by fetching GHL contact data and extracting the same sub-client label from contact “custom variables” (with safe fallbacks).

## Constraints
- Webhooks are untrusted input: validate/sanitize and avoid logging PII.
- `SmsCampaign` is scoped per workspace (`clientId`) via `@@unique([clientId, nameNormalized])`.
- Avoid breaking existing attribution for leads that already have `smsCampaignId`.
- Backfill must be rate-limited and support `--dry-run`.
- Never commit secrets/tokens; if schema changes occur (not expected), run `npm run db:push`.

## Success Criteria
- [ ] Inbound SMS with a sub-client label results in:
  - `SmsCampaign` row present for that workspace
  - `Lead.smsCampaignId` set
  - The label appears in the dashboard SMS sub-client filter list
- [ ] Backfill reduces `smsCampaignId = null` counts for the targeted workspaces and correctly assigns a sample of known leads.
- [ ] Logging/telemetry is sufficient to diagnose future unmapped payload shapes without exposing PII.

## Subphase Index
- a — Confirm payload shape + harden webhook extraction + auto-create
- b — Backfill script (GHL contact “custom variables” → `SmsCampaign`)
- c — Verification plan (counts + spot checks) + operational checklist
- d — Rollout plan (deploy + run backfill + post-checks)

## Notes
- The codebase already supports `SmsCampaign` creation via `prisma.smsCampaign.upsert(...)` when a label is present; the main risk is payload-field drift (label present but not under `customData.Client`).
- There is an existing tags-based backfill script (`scripts/backfill-sms-campaign.ts`). This phase adds/extends support for contact “custom variables” (custom fields/values) to match how Uday/Owen store the label.
