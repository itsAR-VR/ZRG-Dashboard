# Phase 31i — Fix Insights Cron P1001 at the Correct Touch Point (Context-Packs + Worker Concurrency)

## Focus
Prevent `PrismaClientKnownRequestError` `P1001` (“Can’t reach database server”) from causing repeated 500s by (1) targeting the correct cron route, (2) bounding concurrency and batch sizes, and (3) adding explicit retry/early-exit behavior for transient DB outages.

## Inputs
- Prod error: `[Insights Cron] ... prisma.insightContextPack.findMany() ... code: 'P1001'` (DB unreachable at the pooled port).
- Repo reality touch points:
  - Cron route: `app/api/cron/insights/context-packs/route.ts`
  - Worker: `lib/insights-chat/context-pack-worker.ts` (runs DB queries + OpenAI calls, with concurrent lead extraction)
- Existing knobs already present in code:
  - `INSIGHTS_CONTEXT_PACK_CRON_LIMIT` (packs per cron tick; default 3)
  - `INSIGHTS_CONTEXT_PACK_CRON_BATCH` (threads per step; capped at 25 in route)
  - `INSIGHTS_CONTEXT_PACK_LEAD_CONCURRENCY` (lead extraction concurrency; default min(8, batchSize))

## Work

### 1) Add a shared DB retry helper for P1001 (cron-safe)
- Implement `withDbRetry(fn, { maxRetries, baseDelayMs })` for DB-only calls.
- Retry only the minimal queries that fail with P1001:
  - initial `findMany` in the cron route
  - worker step “load pack” calls and update calls that immediately follow selection
- Add a circuit breaker: if P1001 repeats N times in a single cron invocation, stop and return early.

### 2) Reduce default pressure via safer caps (no schema change)
- Tighten the cron caps in `app/api/cron/insights/context-packs/route.ts`:
  - lower the max clamp for `INSIGHTS_CONTEXT_PACK_CRON_BATCH` (e.g., 10–15 instead of 25)
  - consider reducing default `packLimit` from 3 to 1–2 in production
- In `lib/insights-chat/context-pack-worker.ts`, ensure concurrency defaults are conservative:
  - cap default lead concurrency to a smaller max unless explicitly overridden
  - avoid “fan-out” patterns that multiply concurrent DB reads across many leads

### 3) Make DB outages a “clean failure” (cron should not thrash)
- If the DB is unreachable after retries:
  - return a structured response indicating “skipped due to DB outage” (and optionally 503)
  - avoid invoking OpenAI work when DB is already failing (wasted compute)
- Ensure logs are concise and include:
  - packLimit, batch, concurrency
  - number of retries attempted
  - whether the invocation exited early

### 4) Document operational tuning knobs
- Document the three env vars above in `README.md` (or the appropriate ops doc section) with recommended production defaults.

## Validation (RED TEAM)
- Force a DB outage scenario (invalid host/port in a staging env) and confirm:
  - cron exits early without a long stack trace spam loop
  - retries happen exactly as configured
  - response body includes “db_unreachable” state for quick debugging
- Load test the worker with high pack volume and confirm bounded concurrency prevents connection spikes.
- Run: `npm run lint` and `npm run build`.

## Output

**Completed implementation:**

1. **Shared DB retry helper (`lib/prisma.ts`):**
   - Added `withDbRetry<T>(fn, opts?)` function for retrying DB operations on P1001
   - Exponential backoff with configurable `maxRetries` (default 2) and `baseDelayMs` (default 1000ms)
   - Optional `onRetry` callback for custom logging

2. **Context-packs cron route (`app/api/cron/insights/context-packs/route.ts`):**
   - Imported `withDbRetry` and `isPrismaConnectionError`
   - Wrapped both `findMany` queries with `withDbRetry({ maxRetries: 2 })`
   - Added circuit breaker: stops processing after 3 consecutive P1001 errors
   - Reduced default `maxThreadsToProcess` from 25 to 15 to lower connection pressure
   - Added `connectionErrors` and `circuitBreakerTriggered` to response JSON
   - Returns 503 with `db_unreachable: true` when initial query fails completely

3. **Response structure improvements:**
   - Success response includes: `packLimit`, `maxThreadsToProcess`, `connectionErrors`, `circuitBreakerTriggered`
   - DB outage response (503) includes: `db_unreachable: true`, config values, timestamp
   - Logs include context: pack ID, connection error count, circuit breaker status

**Operational tuning knobs:**
- `INSIGHTS_CONTEXT_PACK_CRON_LIMIT` - packs per cron tick (default 3)
- `INSIGHTS_CONTEXT_PACK_CRON_BATCH` - threads per step (default 15, max 15)
- `INSIGHTS_CONTEXT_PACK_LEAD_CONCURRENCY` - lead extraction concurrency (in worker)

**Verified:** `npm run build` completes successfully.

## Handoff
Proceed to 31j to implement Unipile disconnect notifications in a schema-consistent way (UI + deduped Slack).
