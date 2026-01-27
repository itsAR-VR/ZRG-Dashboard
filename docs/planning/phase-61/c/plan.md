# Phase 61c — Add Staleness Metrics and Logging

## Focus
Enhance `refreshAvailabilityCachesDue()` to return staleness metrics that enable monitoring of cache health across all workspaces. This provides visibility into whether the refresh throughput is keeping up with demand.

## Inputs
- Phase 61b: Dedicated cron endpoint in place
- Current `refreshAvailabilityCachesDue()` in `lib/availability-cache.ts`

## Work

### 1. Add staleness metrics query

Before processing refreshes, query for overall cache health:

```typescript
// In refreshAvailabilityCachesDue(), add metrics collection:

const now = new Date();
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

// Count caches by staleness level
const [totalCaches, staleCaches, veryStale, criticallyStale] = await Promise.all([
  prisma.workspaceAvailabilityCache.count(),
  prisma.workspaceAvailabilityCache.count({
    where: { staleAt: { lte: now } },
  }),
  prisma.workspaceAvailabilityCache.count({
    where: { fetchedAt: { lte: oneHourAgo } },
  }),
  prisma.workspaceAvailabilityCache.count({
    where: { fetchedAt: { lte: oneDayAgo } },
  }),
]);

// Find oldest cache
const oldestCache = await prisma.workspaceAvailabilityCache.findFirst({
  orderBy: { fetchedAt: "asc" },
  select: { fetchedAt: true, clientId: true },
});

const oldestCacheAgeMinutes = oldestCache?.fetchedAt
  ? Math.round((now.getTime() - oldestCache.fetchedAt.getTime()) / 60000)
  : null;
```

### 2. Update return type

Extend the return object:

```typescript
return {
  checked: clientIds.length,
  refreshed,
  skippedNoDefault,
  skippedUnsupportedDuration,
  errors,
  // NEW: Staleness metrics
  metrics: {
    totalCaches,
    staleCaches,
    veryStale,        // >1 hour since fetch
    criticallyStale,  // >24 hours since fetch
    oldestCacheAgeMinutes,
  },
};
```

### 3. Add warning logs for critical staleness

```typescript
if (criticallyStale > 0) {
  console.warn("[Availability] Critically stale caches detected", {
    count: criticallyStale,
    oldestAgeMinutes: oldestCacheAgeMinutes,
  });
}
```

### 4. Update cron endpoint response

In `app/api/cron/availability/route.ts`, the response now includes:
```json
{
  "success": true,
  "checked": 100,
  "refreshed": 95,
  "metrics": {
    "totalCaches": 150,
    "staleCaches": 50,
    "veryStale": 5,
    "criticallyStale": 0,
    "oldestCacheAgeMinutes": 45
  },
  "durationMs": 12500,
  "timestamp": "2026-01-27T..."
}
```

### 5. Verification
- `npm run lint`
- `npm run build`
- Test endpoint returns metrics

## Output
- Enhanced `refreshAvailabilityCachesDue()` with comprehensive metrics:
  - `totalCaches` - Total availability cache records
  - `dueCaches` - Caches currently stale (staleAt <= now)
  - `erroringCaches` - Caches with lastError != null
  - `oldestSuccessfulRangeStartAgeMinutes` - Age of oldest successful refresh (using `rangeStart` as proxy)
  - `oldestSuccessfulClientId` - Client ID of the oldest cache

**Response Shape:**
```typescript
{
  invocationId: string | null;
  mode: "due" | "all";
  checked: number;
  attempted: number;
  refreshed: number;
  skippedNoDefault: number;
  skippedUnsupportedDuration: number;
  skippedBackoff: number;
  errors: string[];
  finishedWithinBudget: boolean;
  metrics: {
    totalCaches: number;
    dueCaches: number;
    erroringCaches: number;
    oldestSuccessfulRangeStartAgeMinutes: number | null;
    oldestSuccessfulClientId: string | null;
  };
}
```

**Status:** ✅ Complete (2026-01-27)

## Handoff
Phase 61d configures the cron schedule in `vercel.json` to run every minute.
