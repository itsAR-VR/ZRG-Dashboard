# Phase 53 — Verification + Rollback Runbook

This runbook is scoped to the production issues captured in `logs_result.csv` (2026-01-23) and the Phase 53 changes (webhook burst hardening, inbox counts performance, auth noise, AI verifier resilience, integration health gating).

## Deploy Order (Safe Rollout)

1) **Apply Prisma schema to the correct database**
- Run `npm run db:push` against the intended DB (`DIRECT_URL` configured for Prisma CLI).
- This repo uses Prisma, so the database schema must be updated before deploying code that references the updated Prisma schema.

2) **(Recommended) Run the Phase 53 ship check**
- Run:
  - `node --import tsx scripts/phase-53-ship-check.ts --strict` (preferred)
  - `npx tsx scripts/phase-53-ship-check.ts --strict` (alternative)

3) **Backfill rollups (recommended immediately after schema push)**
- Run once:
  - `node --import tsx scripts/backfill-lead-message-rollups.ts` (preferred)
  - `npx tsx scripts/backfill-lead-message-rollups.ts` (alternative)
- Or per workspace:
  - `node --import tsx scripts/backfill-lead-message-rollups.ts --clientId <workspaceId>` (preferred)
  - `npx tsx scripts/backfill-lead-message-rollups.ts --clientId <workspaceId>` (alternative)

4) **Deploy code with feature flags OFF**
- Ensure these are **off** initially:
  - `INBOXXIA_EMAIL_SENT_ASYNC` (requires `WebhookEvent` table)
  - `UNIPILE_HEALTH_GATE` (requires new Lead fields, plus operator comfort)

5) **Enable flags gradually**
- Enable `INBOXXIA_EMAIL_SENT_ASYNC=1` first.
- Enable `UNIPILE_HEALTH_GATE=1` after confirming LinkedIn followups behave as intended.
- Optionally enable `LOG_SLOW_PATHS=1` temporarily for deeper diagnostics (turn off after validation).

## Verification Checklist

### A) Email webhook burst resilience
- Confirm `POST /api/webhooks/email` returns quickly for `EMAIL_SENT` (should enqueue and exit).
- In Vercel logs, check:
  - No `Vercel Runtime Timeout Error: Task timed out after 60 seconds` on `/api/webhooks/email`
  - No bursty 504 clusters during provider retries
- In DB, verify `WebhookEvent` rows transition `PENDING → SUCCEEDED` via cron (and failures retry with backoff).

### B) Inbox counts stability
- In Vercel logs, confirm absence of:
  - `Raw query failed. Code: 57014. Message: canceling statement due to statement timeout`
- Spot check a large workspace:
  - Sidebar counts load consistently (no long waits / “infinite loading”).

### C) Auth/session noise
- In Vercel logs, confirm normal signed-out navigation does **not** spam:
  - `refresh_token_not_found`
  - `DOMException [AbortError]`
- Confirm protected routes still redirect correctly to `/auth/login`.

### D) AI verifier + ledger stability
- Confirm Step-3 verifier warnings/errors are not spamming logs (unless `LOG_SLOW_PATHS=1` is enabled).
- Confirm no `P2028 Unable to start a transaction in the given time` originating from slot offer ledger increments.

### E) Unipile health gating
- For a disconnected Unipile workspace:
  - Confirm workspace is marked `DISCONNECTED` and Slack notification is sent at most 1/day.
  - Confirm LinkedIn follow-up instances pause with reason `unipile_disconnected` when `UNIPILE_HEALTH_GATE=1`.
- For an invalid LinkedIn recipient (Unipile 422):
  - Confirm the lead is marked unreachable (`Lead.linkedinUnreachableAt` set) and follow-ups pause with reason `linkedin_unreachable` when `UNIPILE_HEALTH_GATE=1`.

## Rollback

### Immediate mitigations
- If webhook ingestion regresses:
  - Set `INBOXXIA_EMAIL_SENT_ASYNC=0` (reverts to prior synchronous behavior).
- If LinkedIn gating is too aggressive:
  - Set `UNIPILE_HEALTH_GATE=0` (disables pre-check + auto-pausing logic).

### Data cleanup (if needed)
- `WebhookEvent` queue rows are safe to keep; failed rows can be inspected and replayed by setting `status=PENDING` and `runAt=now()` (manual/admin only).
- If lead LinkedIn unreachable flags were set incorrectly, clear:
  - `Lead.linkedinUnreachableAt = null`, `Lead.linkedinUnreachableReason = null`
