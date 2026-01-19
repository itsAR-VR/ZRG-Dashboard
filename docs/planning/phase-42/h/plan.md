# Phase 42h — EmailBison Per-Workspace Base Host Allowlist + Selection UI

## Focus
Add a safe, DB-backed allowlist of EmailBison base hosts and let each workspace select which host it uses (to support white-label EmailBison/Inboxxia accounts in a single deployment).

## Inputs
- Phase 42 review follow-up: per-workspace base host allowlist + selection UI
- Current EmailBison base URL override: `EMAILBISON_BASE_URL` (deployment-wide)
- Current integration settings UI: `components/dashboard/settings/integrations-manager.tsx`
- EmailBison client: `lib/emailbison-api.ts` (must accept per-request base host)
- Call sites that must thread base host: `lib/conversation-sync.ts`, `actions/email-campaign-actions.ts`, `actions/enrichment-actions.ts`, `lib/reactivation-engine.ts`

## Work
- Add Prisma schema support:
  - `EmailBisonBaseHost` model (hostname + optional label; unique host)
  - `Client.emailBisonBaseHostId` optional relation (onDelete: SetNull)
- Add server actions:
  - list/create/delete EmailBison base hosts (validated hostname-only; disallow IP/localhost; lowercase normalize)
  - set/clear a workspace’s selected base host
  - seed defaults (idempotent upsert): `send.meetinboxxia.com`, `send.foundersclubsend.com`
- Update Integrations UI:
  - show base host selector for EmailBison workspaces
  - provide “Manage Hosts” section to add/remove allowed base hosts
- Thread base host through EmailBison client + all call sites so requests use the selected host (fall back to env var/default when unset).
- Run `npm run db:push` (schema changed) and ensure build still passes.

## Output
- Added DB-backed base host allowlist + workspace selection:
  - Prisma: new `EmailBisonBaseHost` model + optional `Client.emailBisonBaseHostId` relation (onDelete: SetNull) in `prisma/schema.prisma`.
  - Actions: CRUD + default seeding (`send.meetinboxxia.com`, `send.foundersclubsend.com`) in `actions/emailbison-base-host-actions.ts`; wired `actions/client-actions.ts` to read/write `emailBisonBaseHostId` (EmailBison-only; clears when switching providers).
  - UI: Settings → Integrations now includes a “Manage EmailBison Base Hosts” section plus a per-workspace selector for EmailBison workspaces in `components/dashboard/settings/integrations-manager.tsx`.
- Threaded the selected base host through the EmailBison client and all call sites:
  - `lib/emailbison-api.ts` now accepts `{ baseHost }` per request with safe hostname validation + env/default fallback.
  - Updated sync/campaign/enrichment/reply/reactivation/background-job call sites to pass `{ baseHost: client.emailBisonBaseHost?.host }` (see `lib/conversation-sync.ts`, `actions/email-campaign-actions.ts`, `actions/enrichment-actions.ts`, `actions/email-actions.ts`, `lib/reactivation-engine.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/phone-enrichment.ts`).
- Validation:
  - `npm run db:push` succeeded (schema synced).
  - `npm run build` succeeded.

## Coordination Notes
- Phase 43 plan exists and also targets `prisma/schema.prisma` + inbox access control. Keep Phase 42 changes committed/merged before starting Phase 43 schema work to avoid drift.

## Handoff
Proceed to Phase 42i to offload conversation sync from `POST /` Server Actions by enqueueing BackgroundJobs and updating InboxView to use enqueue-only actions.
