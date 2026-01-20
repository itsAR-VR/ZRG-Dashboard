# Phase 44 — Review

## Summary

- Implemented a per-workspace **EmailBison Base Host** setting in Settings → Integrations (unblocks Founders Club vs ZRG host mismatches without SQL).
- Relaxed integrations edit gating to allow **workspace admins** (not only global admins) to edit integrations.
- Added Calendly webhook “missing signing key” handling to force webhook recreation (captures signing key on the next “Ensure Webhooks” click).
- Quality gates: `npm run lint` (warnings only) and `npm run build` pass.
- Production verification not performed here (no deploy and no DB-side SQL backfill run in this environment).

## What Shipped (Working Tree)

- `actions/emailbison-base-host-actions.ts` — add `getClientEmailBisonBaseHost(clientId)`.
- `components/dashboard/settings-view.tsx` — add per-workspace EmailBison Base Host card under Settings → Integrations.
- `actions/client-actions.ts`, `components/dashboard/settings/integrations-manager.tsx` — gate “Edit Integrations” using workspace admin capability.
- `actions/calendly-actions.ts` — if subscription exists but local signing key is missing, delete+recreate webhook to capture the signing key.

**Out of scope but present in working tree:** `scripts/crawl4ai/*` changes (Phase 40). Keep separate to avoid mixing concerns.

## Verification

### Commands

- `npm run lint` — pass (0 errors, 17 warnings) (Tue Jan 20 11:05:12 +03 2026)
- `npm run build` — pass (Tue Jan 20 11:05:41 +03 2026)
- `npm run db:push` — skipped (no `prisma/schema.prisma` changes)

### Notes

- Next.js build warns about multiple lockfiles and deprecated `middleware` convention; unrelated to Phase 44 changes.
- Jam artifacts could not be fetched in this environment (`jam` MCP requires auth).

## Success Criteria → Evidence

1. Email sends succeed from Founders Club workspace
   - Evidence: per-workspace EmailBison base host setting implemented, but no production send test performed.
   - Status: partial

2. Email sends succeed from ZRG workspaces
   - Evidence: per-workspace EmailBison base host setting implemented, but no production send test performed.
   - Status: partial

3. Calendly “Ensure Webhooks” stores signing key
   - Evidence: `actions/calendly-actions.ts` now recreates webhook when signing key is missing locally.
   - Status: partial (needs deploy + user action)

4. Calendly booking webhooks are received and processed
   - Evidence: not tested.
   - Status: not met

5. No new errors in logs related to these issues
   - Evidence: not monitored post-deploy.
   - Status: not met

## Plan Adherence

- Planned SQL backfill (44a/44d) was **not executed** in this environment; approach shifted to a workspace-level setting so the correct EmailBison host can be set without manual SQL.
- Additional scope: integrations edit gating updated to use workspace-admin capability (user reported they “can’t even edit integrations”).

## Risks / Rollback

- Risk: Workspaces with an incorrect/missing EmailBison base host will continue to hit `401` until configured correctly.
  - Mitigation: after deploy, set base host per workspace via Settings → Integrations → EmailBison Base Host.
- Risk: Calendly webhooks will continue to be rejected if the signing key remains missing in DB.
  - Mitigation: deploy, click “Ensure Webhooks” to recreate, confirm `calendlyWebhookSigningKey` is stored.

## Follow-ups

- Deploy Phase 44 code changes.
- For each workspace:
  - Set EmailBison base host (ZRG → `send.meetinboxxia.com`, Founders Club → `send.foundersclubsend.com`) and retry an email send.
  - Click Calendly “Ensure Webhooks” and run a test booking.
- Monitor logs post-deploy for EmailBison `401` and Calendly signature verification failures.
