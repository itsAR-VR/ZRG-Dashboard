# Phase 154c — Workspace Inbox Counts Materialization (`inbox_counts`) + Dirty Marking + Recompute Job

## Focus
Make inbox counts cheap and predictable by storing per-workspace rollups in Postgres (Supabase) and recomputing them when the workspace is marked “dirty”. This avoids repeated full scans on every sidebar refresh.

## Inputs
- Current counts semantics: `actions/lead-actions.ts` `getInboxCounts` (raw SQL is the source of truth for categories).
- Supabase Postgres (project ref `pzaptpgrcezknnsfytob`) and existing `Lead` rollup columns.
- KV version bump primitive from Phase 154b (used to invalidate cached counts after recompute).

## Work
1. Define the canonical count categories (match current sidebar):
   - `allResponses`, `requiresAttention`, `previouslyRequiredAttention`, `needsRepair`, `aiSent`, `aiReview`, plus `updatedAt`.
2. Add Postgres objects (SQL executed in Supabase):
   - Table `inbox_counts` keyed by `clientId` (workspace).
   - Table `inbox_counts_dirty` keyed by `clientId` with `dirtyAt`.
   - Function `recompute_inbox_counts(client_id uuid)` that writes `inbox_counts` using `COUNT(*) FILTER (...)` and the same join semantics as current `getInboxCounts`.
   - Triggers:
     - On `Lead` updates that affect inbox membership (at minimum: `status`, `sentimentTag`, `snoozedUntil`, `lastInboundAt`, `lastOutboundAt`, `lastZrgOutboundAt`, `assignedToUserId`) mark the workspace dirty.
     - On `Message` inserts, mark the workspace dirty for the message’s lead workspace (or rely on lead rollup updates if those are guaranteed).
3. Add a recompute job runner:
   - First iteration: keep it as a cron-triggered server route that processes dirty workspaces in small batches (limit + advisory lock).
   - Later iteration (Phase 154e): move this into Inngest for durable retries/backoff.
4. Update counts API:
   - Prefer reading from `inbox_counts` (O(1)).
   - Fallback to legacy computation if the table is missing (safe rollout).
5. Invalidation:
   - After a successful recompute, bump `inbox:v1:ver:{clientId}` so caches refresh.

## Output
- Workspace counts are available as O(1) reads from `inbox_counts`.
- Dirty marking + recompute loop keeps counts fresh without sidebar polling storms.

## Handoff
Proceed to Phase 154d to wire realtime updates (sessioned + RLS) and remove high-frequency polling in the client.

