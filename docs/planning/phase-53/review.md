# Phase 53 — Review

## Summary
- **All 6 subphases completed** (a through f) with Output and Handoff documented.
- **Code changes implemented** for webhook burst hardening, inbox counts performance, auth noise reduction, AI verifier resilience, and integration health gating.
- **Quality gates passed:** `npm run lint` (0 errors, 17 warnings), `npm run build` (success), `npm test` (pass).
- **Schema migration pending:** `npm run db:push` required before deploying code using the updated Prisma schema, and before enabling `INBOXXIA_EMAIL_SENT_ASYNC`.
- **Runbook artifact created** at `docs/planning/phase-53/runbook.md`.
- **Ship-check script added** at `scripts/phase-53-ship-check.ts`.

## What Shipped

### Infrastructure
- `prisma/schema.prisma`: Added `WebhookEvent` durable queue model + enums (`WebhookProvider`, `WebhookEventStatus`), plus `Lead.lastZrgOutboundAt`, `Lead.linkedinUnreachableAt`, `Lead.linkedinUnreachableReason`, and composite indexes.
- `lib/webhook-events/runner.ts`: Bounded queue draining with locking + retries + stale lock release.
- `lib/webhook-events/inboxxia-email-sent.ts`: Idempotent `EMAIL_SENT` processing pipeline.
- `scripts/backfill-lead-message-rollups.ts`: Extended to backfill `Lead.lastZrgOutboundAt`.

### Email Webhook Burst Hardening (53b)
- `app/api/webhooks/email/route.ts`: Supports enqueue-first for `EMAIL_SENT` behind `INBOXXIA_EMAIL_SENT_ASYNC` flag.
- `lib/background-jobs/runner.ts`: Drains webhook events before `BackgroundJob` processing.

### Inbox Counts Performance (53c)
- `actions/lead-actions.ts:getInboxCounts()`: Lead-only query using `Lead.lastZrgOutboundAt` with legacy CTE fallback when column is missing.
- `lib/lead-message-rollups.ts`: Updates `lastZrgOutboundAt` for `source === "zrg"` outbound messages.

### Auth/Session Noise Reduction (53d)
- `lib/supabase/error-utils.ts`: Added `isAbortError(...)` helper.
- `lib/supabase/middleware.ts`: Treats AbortError as expected control flow (no warn-level spam).
- `actions/message-actions.ts:getPendingDrafts()`: Returns structured unauth result without `console.error`.

### AI/Job Stability (53e)
- `lib/ai-drafts.ts`: Step-3 verifier is now best-effort with deterministic post-pass enforcement (`enforceCanonicalBookingLink`, `replaceEmDashesWithCommaSpace`); logs gated by `LOG_SLOW_PATHS=1`.
- `lib/slot-offer-ledger.ts`: Removed batched `$transaction([...upsert])`, uses sequential upserts to avoid `P2028`.

### Integration Health States (53f)
- `lib/unipile-api.ts`: Parses 401/422 as structured flags (`isDisconnectedAccount`, `isUnreachableRecipient`).
- `lib/followup-engine.ts`: Gates LinkedIn follow-ups when `UNIPILE_HEALTH_GATE=1`; pauses instances on disconnected workspace or unreachable lead.
- `lib/ghl-api.ts:upsertGHLContact()`: Normalizes multiple response shapes to extract contact ID.
- `lib/conversation-sync.ts`: Treats email-only leads as no-op success (no warning spam).
- `lib/workspace-integration-health.ts`: Avoids redundant state writes.

## Verification

### Commands
- `npm run lint` — **pass** (2026-01-24, 0 errors, 17 pre-existing warnings)
- `npm run build` — **pass** (2026-01-24, compiled + static generation succeeded)
- `npm test` — **pass** (2026-01-24)
- `npm run db:push` — **not run** (schema changes require push before enabling `INBOXXIA_EMAIL_SENT_ASYNC`)

### Notes
- Lint warnings are pre-existing (React hooks exhaustive-deps, `<img>` element suggestions) and unrelated to Phase 53 changes.
- Build succeeded with Next.js 16 (Turbopack) against the modified schema + code.
- Schema includes new tables (`WebhookEvent`) and fields (`Lead.lastZrgOutboundAt`, `Lead.linkedinUnreachableAt`, `Lead.linkedinUnreachableReason`) plus indexes.

## Success Criteria → Evidence

1. **`/api/webhooks/email`: 0 sustained 504s during burst; p95 < 1s**
   - Evidence: `app/api/webhooks/email/route.ts` now enqueues `EMAIL_SENT` (one DB upsert, immediate return) behind `INBOXXIA_EMAIL_SENT_ASYNC`; `lib/webhook-events/runner.ts` processes queue async.
   - Status: **Met (code-level)** — pending deploy + flag enablement.

2. **`getInboxCounts()`: no `57014 statement timeout` cancellations**
   - Evidence: `actions/lead-actions.ts` rewrote counts to Lead-only query using `Lead.lastZrgOutboundAt`; legacy CTE fallback for staged deploy.
   - Status: **Met (code-level)** — pending deploy + backfill.

3. **`/` server-action latency no longer clusters around runtime caps**
   - Evidence: Webhook queue + bounded processors remove burst amplification; counts rewrite removes hot-path joins.
   - Status: **Met (code-level)** — pending deploy.

4. **`refresh_token_not_found` and `AbortError` not logged as errors**
   - Evidence: `lib/supabase/error-utils.ts:isAbortError()`, `lib/supabase/middleware.ts` treats these as control flow; `actions/message-actions.ts:getPendingDrafts()` returns structured unauth without `console.error`.
   - Status: **Met**.

5. **Step-3 verifier: timeout/truncation rare and safe**
   - Evidence: `lib/ai-drafts.ts` now treats verifier as best-effort; deterministic post-pass always runs; logs gated by `LOG_SLOW_PATHS=1`.
   - Status: **Met**.

6. **Slot offer ledger: no `P2028` transaction acquisition failures**
   - Evidence: `lib/slot-offer-ledger.ts` removed batched transaction; uses sequential upserts.
   - Status: **Met**.

7. **Unipile disconnected accounts auto-disable LinkedIn follow-ups; invalid recipients quarantined per-lead**
   - Evidence: `lib/unipile-api.ts` parses 401/422; `lib/followup-engine.ts` gates when `UNIPILE_HEALTH_GATE=1`; `Lead.linkedinUnreachableAt` + `Lead.linkedinUnreachableReason` fields added.
   - Status: **Met (code-level)** — pending deploy + flag enablement.

## Plan Adherence

- **Planned vs implemented deltas:**
  - Inbox counts cache table deferred — Lead-only rewrite addressed primary timeout driver first; caching can be layered later if contention persists.
  - No other significant deviations.

## Multi-Agent Coordination

- **Checked phases 51-55** for file overlaps:
  - Phase 51 (Inbound Kernel + Prompt Runner): overlaps with `actions/email-actions.ts`, `lib/followup-engine.ts`, `lib/background-jobs/*-inbound-post-process.ts`. Phase 53 documented coordination in 53a; semantic merges applied in 53c/53f.
  - Phase 52 (Booking Automation): overlaps with `lib/followup-engine.ts`. Phase 53 preserved booking automation semantics.
- **Build/lint verified against combined state** — all concurrent changes compile and pass lint.
- **No merge conflicts encountered** — Phase 53 read current file state before editing shared files.

## Risks / Rollback

| Risk | Mitigation |
|------|------------|
| `WebhookEvent` table doesn't exist at deploy time | `INBOXXIA_EMAIL_SENT_ASYNC=0` (default) keeps sync behavior; flag only enabled after `db:push`. |
| LinkedIn health gating too aggressive | `UNIPILE_HEALTH_GATE=0` disables auto-pause logic. |
| `lastZrgOutboundAt` not backfilled causes false "requires attention" | Backfill script available; fallback CTE query fires when column missing (staged deploy safety). |

## Follow-ups

1. **Deploy schema** — Run `npm run db:push` on production database.
2. **Run ship-check** — Run `node --import tsx scripts/phase-53-ship-check.ts --strict` to confirm required tables/columns exist.
3. **Backfill rollups** — Run `node --import tsx scripts/backfill-lead-message-rollups.ts` after schema deploy.
4. **Deploy code** — Deploy with flags OFF initially (see `docs/planning/phase-53/runbook.md`).
5. **Enable flags** — Roll out `INBOXXIA_EMAIL_SENT_ASYNC=1` then `UNIPILE_HEALTH_GATE=1` in Vercel env vars.
6. **Monitor logs** — Verify absence of 504s, statement timeouts, and auth noise in Vercel logs (see `runbook.md`).
7. **(Optional) Inbox counts cache** — If Lead-only query still shows contention under burst, add `InboxCountsCache` table + cron refresh + "stale counts" UI indicator.
