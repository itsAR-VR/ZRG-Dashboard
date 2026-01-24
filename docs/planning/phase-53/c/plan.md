# Phase 53c — Inbox Counts Performance Hardening (Indexes/Precompute/Cache + Safe Fallback)

## Focus
Eliminate `getInboxCounts()` statement timeouts (`P2010` / Postgres `57014`) and reduce `/` server-action latency by making inbox counts fast, predictable, and resilient to DB contention.

## Inputs
- `actions/lead-actions.ts:getInboxCounts()` (current `prisma.$queryRaw` CTE + message aggregation)
- `prisma/schema.prisma` indexes on `Lead` / `Message` (current state)
- Runtime behavior: `/` Server Actions showing ~120s median `durationMs` during incident window

## Work
1. **Profile the current query (staging/local DB copy)**
   - Run `EXPLAIN (ANALYZE, BUFFERS)` on the current SQL with realistic row counts.
   - Identify whether the bottleneck is:
     - scanning large `Message` ranges,
     - missing composite indexes,
     - join cardinality explosion,
     - or lock/connection contention under burst.

2. **Index strategy (low-risk first)**
   - Add targeted indexes to support the exact predicates/grouping:
     - `Message(leadId, direction, source, sentAt DESC)` (or equivalent) for `max(sentAt)` per lead.
     - `Lead(clientId, snoozedUntil, lastInboundAt)` to accelerate reply_leads filter.
     - Include assignment filtering needs if setters are scoped (e.g., `Lead(clientId, assignedToUserId, lastInboundAt)`).
   - Confirm with `EXPLAIN` that the plan actually uses the indexes.

3. **Precompute to avoid aggregating `Message` on every sidebar render**
   - Add `Lead.lastZrgOutboundAt` (or similar) updated whenever a ZRG outbound message is created.
   - Backfill it once from `Message` (`max(sentAt)` where `direction='outbound' and source='zrg'`).
   - Rewrite counts logic to compare `Lead.lastInboundAt` vs `Lead.lastZrgOutboundAt` directly (Lead-only query).

4. **Counts cache (robust fallback under DB contention)**
   - Create a small `InboxCountsCache` table keyed by `(clientId, scopeKey)`:
     - `scopeKey`: `admin` vs `setter:<userId>` (if assignment-based scoping exists).
     - Store: `allResponses`, `requiresAttention`, `previouslyRequiredAttention`, `computedAt`, and a version marker.
   - Refresh via cron on an interval (or opportunistically after inbound ingestion).
   - In `getInboxCounts()`:
     - Try live query with a strict time budget.
     - On timeout/error: return cached counts (with `stale=true`) instead of zeroing silently.

5. **UX: degrade explicitly**
   - If counts are stale/unavailable, surface a subtle “counts delayed” indicator instead of showing zeros (prevents false confidence).

## Output
- **Lead-only counts path:** `actions/lead-actions.ts:getInboxCounts()` now prefers a single Lead-only `prisma.$queryRaw` that compares `Lead.lastInboundAt` vs `Lead.lastZrgOutboundAt` (no `Message` aggregation/join on the hot path).
- **Safe staged rollout:** if `Lead.lastZrgOutboundAt` does not exist yet (staged deploy/migration lag), `getInboxCounts()` detects the missing column (`P2022` / column name match) and falls back to the prior legacy CTE + `Message` aggregation.
- **Schema/indexes:** `prisma/schema.prisma` adds `Lead.lastZrgOutboundAt` plus supporting composite indexes:
  - `Lead(clientId, lastInboundAt DESC)` and `Lead(clientId, assignedToUserId, lastInboundAt DESC)` to support inbox pagination/scoping.
  - `Message(leadId, direction, source, sentAt DESC)` to accelerate any remaining “latest zrg outbound per lead” lookups.
- **Rollup maintenance:** `lib/lead-message-rollups.ts` now updates `lastZrgOutboundAt` only for outbound messages where `source === "zrg"` and recompute rollups also computes the zrg outbound watermark.
- **Backfill:** `scripts/backfill-lead-message-rollups.ts` now also backfills `Lead.lastZrgOutboundAt` via aggregate SQL (idempotent; supports `--clientId`).
- **Deferred (not implemented yet):** a durable inbox-counts cache table + UI “stale counts” indicator. With the Lead-only rewrite, the primary timeout driver (message aggregation) is removed first; caching can be layered later if prod still shows contention.

## Coordination Notes
**Files touched that overlap Phase 51/52:** `actions/email-actions.ts`, `lib/followup-engine.ts` (call sites updated to pass `source: "zrg"` into rollup bumps).  
**Rollout note:** after deploying schema + code, run `npx tsx scripts/backfill-lead-message-rollups.ts` once (or per workspace via `--clientId`) to avoid temporary false-positive “requires attention” counts until organic traffic updates the new rollup field.

## Handoff
Proceed to Phase 53d to remove auth-related log noise and harden server actions against expected unauthorized states.
