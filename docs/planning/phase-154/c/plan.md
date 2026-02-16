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
   - Table `inbox_counts` keyed by `(client_id, is_global, scope_user_id)` so we can serve:
     - global workspace counts (for OWNER/ADMIN/INBOX_MANAGER), and
     - per-setter assigned-lead counts (for SETTER) without recomputing on every sidebar refresh.
   - Table `inbox_counts_dirty` keyed by `client_id` with `dirty_at` (idempotent upsert).
   - Function `recompute_inbox_counts(target_client_id uuid)` that writes `inbox_counts` using `COUNT(*) FILTER (...)` and the same semantics as `actions/lead-actions.ts:getInboxCounts`.
   - Function `mark_inbox_counts_dirty(target_client_id uuid)` to upsert `inbox_counts_dirty`.
   - Trigger function + trigger on `"Lead"` to mark the workspace dirty when rollup fields change.

   **Schema sketch (Postgres, production-grade):**
   ```sql
   -- Rollup table (global + per-setter)
   create table if not exists inbox_counts (
     client_id uuid not null,
     is_global boolean not null,
     scope_user_id text null, -- Supabase auth user id (text in this schema); null only when is_global=true

     all_responses int not null default 0,
     requires_attention int not null default 0,
     previously_required_attention int not null default 0,
     needs_repair int not null default 0,
     ai_sent int not null default 0,
     ai_review int not null default 0,
     total int not null default 0,

     computed_at timestamptz not null default now(),
     updated_at timestamptz not null default now(),

     primary key (client_id, is_global, scope_user_id),
     constraint inbox_counts_scope_ck check (
       (is_global = true and scope_user_id is null) or
       (is_global = false and scope_user_id is not null)
     ),
     constraint inbox_counts_nonneg_ck check (
       all_responses >= 0 and requires_attention >= 0 and previously_required_attention >= 0 and
       needs_repair >= 0 and ai_sent >= 0 and ai_review >= 0 and total >= 0
     )
   );

   create index if not exists inbox_counts_client_global_idx
     on inbox_counts (client_id, is_global);

   -- Dirty marker table (per workspace)
   create table if not exists inbox_counts_dirty (
     client_id uuid primary key,
     dirty_at timestamptz not null default now()
   );

   create index if not exists inbox_counts_dirty_at_idx
     on inbox_counts_dirty (dirty_at asc);
   ```

   **Recompute function (outline):**
   - Use a single scan of `"Lead"` for the target workspace.
   - Use `GROUP BY GROUPING SETS` over `"assignedToUserId"` plus a global row.
   - Drop the “unassigned leads” group to avoid confusing it with the global row.
   - Upsert into `inbox_counts`.

   **Dirty marking trigger (minimal, low-risk):**
   - Do NOT trigger on `"Message"` inserts (it would need a lead lookup per row).
   - Instead, rely on the application already updating lead rollups (`lastInboundAt`, `lastOutboundAt`, `lastZrgOutboundAt`, `status`, `sentimentTag`, `snoozedUntil`, `assignedToUserId`).
   - Add an `AFTER UPDATE OF ... ON "Lead"` trigger to upsert `inbox_counts_dirty`.

   - Triggers:
     - On `Lead` updates that affect inbox membership (at minimum: `status`, `sentimentTag`, `snoozedUntil`, `lastInboundAt`, `lastOutboundAt`, `lastZrgOutboundAt`, `assignedToUserId`) mark the workspace dirty.
     - Explicit decision: do not add `"Message"` triggers in the hot path; rely on lead rollup updates instead.
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
