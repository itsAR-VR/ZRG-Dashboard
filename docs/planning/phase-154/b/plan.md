# Phase 154b — Vercel KV Cache Layer + Safe Cache Keys + Invalidation Primitives

## Focus
Add a shared cache (Vercel KV) for inbox reads so repeated workspace switching and filter changes do not repeatedly hit Postgres. This subphase defines cache keys, TTLs, and invalidation primitives that later realtime and job workers will use.

## Inputs
- GET APIs from Phase 154a:
  - `/api/inbox/conversations`
  - `/api/inbox/conversations/[leadId]`
  - `/api/inbox/counts`
- Multi-tenant scoping logic: `lib/workspace-access.ts`

## Work
1. Add KV integration:
   - Add dependency: `@vercel/kv`
   - New file: `lib/kv.ts` (thin wrapper: `getJson`, `setJson`, `incr`, `del`, `withCache`)
2. Define cache-busting version keys:
   - `inbox:v1:ver:{clientId}` integer (KV `incr`)
   - All cache keys include `ver` so a bump invalidates everything for that workspace without scanning deletes.
3. Define cache keys (must include user scope):
   - Conversations list:
     - `inbox:v1:list:{ver}:{userId}:{clientId}:{setterScope}:{channelsKey}:{sentimentsKey}:{filter}:{score}:{smsClient}:{search}:{cursor}`
   - Conversation detail:
     - `inbox:v1:detail:{ver}:{userId}:{clientId}:{leadId}`
   - Counts:
     - `inbox:v1:counts:{ver}:{userId}:{clientId}:{setterScope}`
4. TTL policy (initial defaults):
   - list first page: 10-20s
   - list subsequent pages: 30-60s
   - counts: 5-10s
   - detail: 5-15s
5. Implement caching in route handlers:
   - On GET hit: return cached JSON with `cacheHit: true` (server-side only; do not expose internals to clients unless needed).
   - On miss: query DB, store KV, return.
   - Use `Cache-Control: private, max-age=0` headers; do not enable shared CDN caching by default.
6. Add invalidation primitive to write paths (minimal first pass):
   - On message send, draft status change, sentiment reanalysis, and webhook ingestion paths:
     - call `bumpInboxWorkspaceVersion(clientId)`
   - Defer exhaustive invalidation mapping until Phase 154d (realtime) and Phase 154e (jobs) are in place.

## Output
- Inbox read APIs are backed by KV with safe, tenant-scoped cache keys and TTLs.
- A single “workspace version bump” primitive exists and is invoked on obvious inbox-mutating writes.

## Handoff
Proceed to Phase 154c to maintain `inbox_counts` so counts become O(1) reads without scanning leads.

