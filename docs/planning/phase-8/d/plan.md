# Phase 8d — Verification Checklist + Rollout/Backfill Guidance

## Focus
Validate correctness and provide a safe rollout path for always-on sync + a global backfill across all clients/leads.

## Inputs
- Sync changes from Phase 8b (always-on resolve/hydrate + rate limiter)
- Backfill runner from Phase 8c
- EmailBison webhook “Interested” behavior confirmed in Phase 8a

## Work
1. Verification matrix:
   - Single-lead “Sync” resolves/hydrates for an email-first lead that has a corresponding GHL contact.
   - “Sync All” performs the same resolve/hydrate behavior in batch and reports hydrated outcomes.
   - Confirm EmailBison `LEAD_INTERESTED` still ensures GHL contact creation/linking.
2. Operational checks:
   - `npm run lint` and `npm run build`
3. Backfill runbook:
   - Run the backfill across all clients/leads and confirm it completes (or can resume) without exceeding GHL limits.
   - Track counts: leads scanned, contacts linked, phones hydrated, not-found, errors, 429 retries.
   - Watch for daily quota pressure (200k/day/location). If needed, pace runs or shard by location across days.
4. Update docs:
   - Add a short section to `README.md` describing the always-on behavior and how to run/resume the backfill.

## Output
- Verified behavior, a backfill runbook, and updated docs.

## Handoff
Monitor logs for GHL rate limiting and iterate on eligibility rules/concurrency if needed.

### Verification Notes (Code-Level)
- Single-lead sync:
  - `smartSyncConversation` always attempts to resolve missing `ghlContactId` via email search (`resolveGhlContactIdForLead`) and then proceeds with SMS sync when resolved: `actions/message-actions.ts`.
- “Sync All”:
  - Uses the same `smartSyncConversation` behavior (no disabling of GHL resolution) and reports `totalLeadUpdated` when hydration occurs: `actions/message-actions.ts`, `components/dashboard/inbox-view.tsx`.
- EmailBison Interested workflow:
  - Still ensures a GHL contact is created/linked for interested/positive signals via `allowCreateWithoutPhone: true`: `app/api/webhooks/email/route.ts:1452`, `app/api/webhooks/email/route.ts:1573`, `app/api/webhooks/email/route.ts:1301`.

### Operational Checks
- `npm run lint` (warnings only)
- `npm run build` (succeeded)

### Backfill Runbook (Resumable)
- Dry run (no DB writes): `npx tsx scripts/backfill-ghl-lead-hydration.ts --dry-run`
- Apply + resumable state: `npx tsx scripts/backfill-ghl-lead-hydration.ts --apply --resume --state-file ./.backfill-ghl-hydration.state.json`
- Watchouts:
  - GHL documented limits: 100 requests / 10 seconds burst; 200,000 requests/day per location/company.
  - If you approach daily quota, pace runs or shard by location across days.

### Docs Updated
- Added “Always-on Contact Hydration (SMS Sync)” + backfill runner usage + new env vars: `README.md`.
