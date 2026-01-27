# Phase 61d — Update `vercel.json` and Environment Defaults

## Focus
Configure the new availability cron job in `vercel.json` to run every minute, and update environment variable defaults to reflect the new 100-workspace-per-minute target.

## Inputs
- Phase 61a-c: Past-date filter, dedicated endpoint, and metrics in place
- Current `vercel.json` cron configuration (7 jobs, Phase 59 changed followups to `* * * * *`)

## Work

### 1. Add availability cron to `vercel.json`

Add new entry:
```json
{
  "path": "/api/cron/availability",
  "schedule": "* * * * *"
}
```

Full crons section after update:
```json
{
  "crons": [
    {
      "path": "/api/cron/followups",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/reactivations",
      "schedule": "*/10 * * * *"
    },
    {
      "path": "/api/cron/background-jobs",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/insights/booked-summaries",
      "schedule": "*/10 * * * *"
    },
    {
      "path": "/api/cron/insights/context-packs",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/appointment-reconcile",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/emailbison/availability-slot",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/availability",
      "schedule": "* * * * *"
    }
  ]
}
```

**Note**: This brings us to 8 cron jobs (within Vercel Pro limit of 10).

### 2. Update followups cron to skip availability

In `app/api/cron/followups/route.ts`, set availability limit to 0 (or remove the call):

Option A - Set limit to 0:
```typescript
const availabilityLimit = Math.max(
  0,
  Number.parseInt(process.env.AVAILABILITY_CRON_LIMIT || "0", 10)
);

if (availabilityLimit > 0) {
  console.log("[Cron] Refreshing availability caches...");
  const availability = await refreshAvailabilityCachesDue({ limit: availabilityLimit });
  console.log("[Cron] Availability refresh complete:", availability);
}
```

Option B - Remove entirely (cleaner, but requires coordinated deploy):
```typescript
// Remove these lines from followups cron:
// const availability = await refreshAvailabilityCachesDue({ limit: availabilityLimit });
```

Recommendation: **Option A** for safe rollout; can clean up later.

### 3. Document environment variable

Update `CLAUDE.md` or `.env.example` (if exists):
```
# Availability cache refresh limit per cron run
# Default: 100 (processes 100 workspaces per minute)
AVAILABILITY_CRON_LIMIT=100
```

### 4. Verification
- `npm run lint`
- `npm run build`
- Verify `vercel.json` is valid JSON
- Deploy preview and confirm new cron appears in Vercel dashboard

### 5. Post-Deploy Monitoring

After deploy, monitor:
1. Vercel cron logs for `/api/cron/availability`
2. Response metrics: `staleCaches` should trend toward 0
3. `criticallyStale` should be 0 within first hour
4. No timeout errors (function should complete in <60s)

## Output
- Updated `vercel.json` with new cron entry:
  ```json
  { "path": "/api/cron/availability", "schedule": "* * * * *" }
  ```
- Updated `app/api/cron/followups/route.ts` to skip availability (comment on lines 48-49)
- Environment defaults:
  - `AVAILABILITY_CACHE_TTL_MS` defaults to 60,000 (1 minute)
  - `AVAILABILITY_CRON_TIME_BUDGET_MS` defaults to 55,000 (55 seconds)
  - `AVAILABILITY_CRON_CONCURRENCY` auto-computed or env-configurable

**Cron Schedule (8 jobs total):**
- `/api/cron/availability` - `* * * * *` (every minute)
- Other crons unchanged

**Status:** ✅ Complete (2026-01-27)

## Handoff
Phase 61e adds throughput hardening (ordering, budget, lock, metrics). Phase 61f clarifies scaling and cross-cron coordination.

## Rollback Plan

If issues arise:
1. Remove `/api/cron/availability` entry from `vercel.json`
2. Restore `AVAILABILITY_CRON_LIMIT=20` (or default) in followups cron
3. Redeploy

The past-date filter (Phase 61a) is safe to keep regardless.
