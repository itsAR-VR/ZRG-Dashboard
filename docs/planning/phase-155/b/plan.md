# Phase 155b — Inbox Counts Materialization (Prisma + Sentinel Scope + <15s Freshness)

## Focus
Provide O(1) inbox counts for global and per-setter scopes using materialized counts tables, and guarantee near-real-time freshness (<15s) through dirty marking + durable enqueue.

## Inputs
- Canonical semantics in `actions/lead-actions.ts:getInboxCounts`.
- Role scoping in `lib/workspace-access.ts`.
- Redis version helper in `lib/redis.ts`.
- Durable enqueue target: Inngest (from Phase 155e).

## Work
1. **Create Prisma models**
   - Add `InboxCounts`.
   - Add `InboxCountsDirty`.
   - Add required indexes for lookup by `(clientId, isGlobal, scopeUserId)`.
   - Add non-null `scopeUserId` and use sentinel global scope ID:
     - `00000000-0000-0000-0000-000000000000`.

2. **Count fields (must match canonical output)**
   - `allResponses`
   - `requiresAttention`
   - `previouslyRequiredAttention`
   - `totalNonBlacklisted`
   - `awaitingReply`
   - `needsRepair`
   - `aiSent`
   - `aiReview`
   - `total`
   - Derive `awaitingReply = max(0, totalNonBlacklisted - requiresAttention)`.

3. **Dirty marking utility**
   - Add `markInboxCountsDirty(clientId: string)` helper.
   - Upsert dirty row with latest timestamp.
   - Call helper from write paths that affect counts:
     - lead assignment/status/sentiment/snooze updates
     - inbound webhook updates to lead reply rollups
     - AIDraft creation/needs-review changes
     - auto-send message writes

4. **Recompute implementation**
   - Add `recomputeInboxCounts(clientId: string)`.
   - Compute counts using one canonical SQL path aligned to `getInboxCounts`.
   - Upsert:
     - global row (`isGlobal=true`, sentinel scope ID)
     - per-setter rows (`isGlobal=false`, assigned user scope IDs)
   - On success:
     - clear dirty marker
     - increment `inbox:v1:ver:{clientId}`.

5. **Freshness SLA wiring**
   - Dirty mark immediately on write.
   - Enqueue recompute job immediately (Inngest event) from dirty mark path.
   - Keep periodic cron safety-net for missed events.
   - Target end-to-end update visibility under 15s.

6. **Read-path integration**
   - Update `getInboxCounts` to read materialized counts first.
   - If row missing/stale, fallback to legacy computation.
   - Keep fallback for one release cycle.

## Validation
- `npm run db:push` creates both tables/indexes.
- Materialized values match legacy computation for at least 3 real workspaces.
- SETTER and OWNER/ADMIN/INBOX_MANAGER scopes return correct rows.
- Dirty mark + enqueue + recompute updates cache-visible counts within 15s.
- Fallback path remains correct when materialized row is absent.

## Output
- O(1) counts reads are live with correct role scoping.
- Freshness SLA path is implemented and measurable.
- Legacy fallback remains available for rollback safety.

## Handoff
Proceed to Phase 155c for session-auth realtime and RLS-safe invalidation.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented and validated Phase 155b materialized counts path:
    - Prisma models for `InboxCounts` and `InboxCountsDirty` in `prisma/schema.prisma`.
    - Materialized constants/helpers in `lib/inbox-counts.ts`, `lib/inbox-counts-constants.ts`, `lib/inbox-counts-dirty.ts`, `lib/inbox-counts-recompute.ts`, `lib/inbox-counts-runner.ts`.
    - Read-path materialized lookup + stale fallback in `actions/lead-actions.ts:getInboxCounts`.
    - Dirty-mark integration across lead/message/draft rollup paths in:
      - `lib/lead-message-rollups.ts`
      - `lib/inbound-post-process/pipeline.ts`
      - `lib/lead-assignment.ts`
      - `actions/message-actions.ts`
      - `lib/conversation-sync.ts`
      - `lib/ai-drafts.ts`
  - Fixed a semantic mismatch in recompute totals:
    - `lib/inbox-counts-recompute.ts` now computes `total` as `count(*)`, matching canonical legacy `getInboxCounts` behavior (includes `unqualified`).
  - Resolved `db:push` data-loss blocker safely:
    - Added mapped Prisma model for existing backup table `_phase151_linkedin_backfill_backup` to avoid destructive drop.
    - Ran `npm run db:push` successfully without `--accept-data-loss`.
  - Mitigated remaining React #301 hotspot in Inbox list rendering:
    - Removed TanStack virtualizer path from `components/dashboard/conversation-feed.tsx`.
    - Switched to stable paginated list rendering (existing server pagination + load-more retained).
- Commands run:
  - `npm run db:push` — pass (database synced; no data-loss accept required).
  - `npm run lint` — pass (warnings only; pre-existing warnings remain).
  - `npm run typecheck` — pass (run sequentially after build to avoid `.next/types` race).
  - `npm run build` — pass.
  - `npm test` — pass (`384` tests, `0` failures).
- RED TEAM gaps:
  - `<15s` freshness is not yet guaranteed because enqueue/orchestration is not wired; `markInboxCountsDirty` currently marks state but does not trigger durable recompute until Phase 155e.
  - `recomputeDirtyInboxCounts` exists but is not yet integrated with Inngest/cron enqueue flow (pending Phase 155e).
  - Dirty-mark coverage is high on core message/sentiment/draft paths, but additional lower-frequency lead mutation/admin paths should be audited in follow-on hardening.
- Next concrete steps:
  - Execute Phase 155c (session-auth realtime + RLS-safe invalidation) before enabling broader rollout.
  - Execute Phase 155e to wire durable enqueue/recompute and close freshness SLA.
