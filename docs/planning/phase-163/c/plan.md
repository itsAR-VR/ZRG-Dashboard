# Phase 163c — Backend Stabilization: Query/Cache/Pool Fixes (Supabase/Prisma)

## Focus
Reduce variance by making server-side reads predictable under load: fewer DB round-trips, stable query plans, safe caching, and explicit timeout behavior.

## Inputs
- 163a variance packet (slow endpoints + patterns)
- 163b timing headers + structured logs
- Prisma schema + existing query code (`actions/*`, `lib/*`, `app/api/inbox/*`)

## Work
1. Identify backend variance drivers:
   - missing/inefficient indexes (use EXPLAIN on representative queries)
   - large row scans / N+1 patterns
   - connection acquisition delays / pool saturation
2. Apply fixes in priority order:
   - query consolidation and projection narrowing
   - targeted indexes (migration-safe rollout, reversible)
   - short-TTL cache-aside for high-frequency reads (Redis/KV) with versioning/invalidation
   - explicit `statement_timeout` where appropriate (fail fast + observable)
3. Add guardrails:
   - ensure cache keys are stable primitives
   - ensure fallback paths are explicit (not silent retries)

## Output
- Backend changes that measurably reduce p95 server duration variance on the identified slow endpoints.

## Handoff
Hand 163d a verified list of “backend is stable” endpoints so frontend work can focus on refetch/render churn only where necessary.

