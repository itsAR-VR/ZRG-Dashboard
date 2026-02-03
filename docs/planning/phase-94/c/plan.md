# Phase 94c — Cron Hardening (Prevent Overlapping Background-Job Runs)

## Focus
Prevent `/api/cron/background-jobs` from running concurrently on Vercel Cron overlap, which can create bursty concurrency and amplify OpenAI timeouts.

## Inputs
- Phase 94a baseline (confirm overlap symptoms and current background-jobs throughput).
- Existing cron patterns:
  - `app/api/cron/availability/route.ts` — advisory lock pattern
  - `app/api/cron/calendar-health/route.ts` — advisory lock pattern
- Background jobs route:
  - `app/api/cron/background-jobs/route.ts`
- Background jobs runner:
  - `lib/background-jobs/runner.ts`

## Work
1) Add Postgres advisory lock to `/api/cron/background-jobs`
   - In `app/api/cron/background-jobs/route.ts`:
     - **Use LOCK_KEY:** `BigInt("63063063063")` (verified unique — availability uses 61..., calendar-health uses 62...)
     - Add `tryAcquireLock()` and `releaseLock()` using:
       - `select pg_try_advisory_lock(${LOCK_KEY}) as locked`
       - `select pg_advisory_unlock(${LOCK_KEY})`
     - Acquire lock **after** auth check and **before** running `processBackgroundJobs()`.
     - If not acquired, return:
       ```json
       { "success": true, "skipped": true, "reason": "locked", "timestamp": "..." }
       ```
     - Release lock in `finally`.

   **Reference implementation** (from `app/api/cron/availability/route.ts:24-33`):
   ```typescript
   const LOCK_KEY = BigInt("63063063063");

   async function tryAcquireLock(): Promise<boolean> {
     const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
     return Boolean(rows?.[0]?.locked);
   }

   async function releaseLock(): Promise<void> {
     await prisma.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`;
   }
   ```

2) Ensure the route remains safe and observable
   - Keep current `CRON_SECRET` authorization behavior unchanged.
   - Keep `export const maxDuration = 800`.
   - Add minimal logging only if needed (avoid log spam every minute).

3) Optional: guardrail on per-tick runtime (no code change if already sufficient)
   - Confirm `lib/background-jobs/runner.ts` already enforces:
     - `BACKGROUND_JOB_CRON_TIME_BUDGET_MS` (default 240s)
     - per-job safety buffer (`deadlineMs - 7_500`)
   - If Phase 94b increases AI timeouts substantially, confirm the time budget is still appropriate for throughput.
     - If not, plan an env adjustment rather than code changes.

## Output
- Added Postgres advisory lock to `app/api/cron/background-jobs/route.ts`:
  - `LOCK_KEY = BigInt("63063063063")`
  - Overlapping invocations return `{ success: true, skipped: true, reason: "locked", timestamp }`
  - Lock is released in `finally` to avoid deadlocks on crashes/exceptions.

## Handoff
Proceed to **Phase 94d** for Vercel env + documentation updates so the new timeouts can be controlled safely in prod.
