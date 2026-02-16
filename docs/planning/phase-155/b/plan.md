# Phase 155b — Inbox Counts Materialization (Postgres `inbox_counts` + Dirty Marking + Recompute)

## Focus
Make inbox counts O(1) reads and predictable under load by materializing per-workspace rollups in Postgres, with dirty marking and a recompute runner. This replaces repeated lead scans on every sidebar refresh.

## Inputs
- Canonical counts semantics: `actions/lead-actions.ts:getInboxCounts`
- Role semantics: `lib/workspace-access.ts:getUserRoleForClient` (OWNER/ADMIN/INBOX_MANAGER vs SETTER)
- Supabase Postgres (project ref `pzaptpgrcezknnsfytob`)
- Redis invalidation primitive (version bump):
  - `inbox:v1:ver:{clientId}`

## Work
1. Define canonical count categories (must match UI exactly):
   - `all_responses`
   - `requires_attention`
   - `previously_required_attention`
   - `needs_repair`
   - `ai_sent`
   - `ai_review`
   - `total`

2. Create Postgres tables + constraints (global + per-setter):
   - `inbox_counts` keyed by `(client_id, is_global, scope_user_id)`
   - `inbox_counts_dirty` keyed by `client_id`

   SQL (baseline):
   ```sql
   create table if not exists inbox_counts (
     client_id uuid not null,
     is_global boolean not null,
     scope_user_id uuid null,

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

   create table if not exists inbox_counts_dirty (
     client_id uuid primary key,
     dirty_at timestamptz not null default now()
   );

   create index if not exists inbox_counts_dirty_at_idx
     on inbox_counts_dirty (dirty_at asc);
   ```

3. Implement dirty marking trigger on `Lead`:
   - Trigger only on updates to rollup fields that affect counts:
     - `status`, `sentimentTag`, `snoozedUntil`,
     - `lastInboundAt`, `lastOutboundAt`, `lastZrgOutboundAt`,
     - `assignedToUserId`
   - Do not add `Message` triggers (avoid hot-path overhead).

4. Implement recompute function:
   - Recompute for a single workspace in one pass, producing:
     - global row (scope_user_id null)
     - per-setter rows (scope_user_id = assignedToUserId; skip null)
   - Use `COUNT(*) FILTER (...)` and match current semantics (including snooze + blacklisted/unqualified behavior).
   - Upsert into `inbox_counts`.
   - On success, delete `inbox_counts_dirty` for that clientId.

5. Update server read path:
   - Modify `actions/lead-actions.ts:getInboxCounts` to:
     1) enforce auth + role scope
     2) try `select` from `inbox_counts` for:
        - global row when role is not SETTER
        - per-setter row when role is SETTER
     3) fallback to legacy computation if the table/function is missing (safe rollout)
   - After recompute, bump `inbox:v1:ver:{clientId}` so Redis keys invalidate quickly.

6. Validation
   - Compare counts from:
     - legacy computation
     - `inbox_counts` rows
   - Validate both:
     - OWNER/ADMIN/INBOX_MANAGER sees global counts
     - SETTER sees assigned-only counts

## Output
- `inbox_counts` serves O(1) counts reads for global + per-setter scopes.
- Workspaces are dirtied by Lead rollup updates and recomputed in the background.

## Handoff
Proceed to Phase 155c to harden Supabase Realtime (session auth + RLS) and wire invalidation to the new cached read paths.

