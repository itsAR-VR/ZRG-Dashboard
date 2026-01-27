# Phase 61a — Add Hard Past-Date Filter to `getWorkspaceAvailabilitySlotsUtc()`

## Focus
Add a defensive filter to `getWorkspaceAvailabilitySlotsUtc()` that strips any slots with dates in the past before returning. This ensures that even if the cache contains stale data, past dates never reach AI draft generation or follow-up templates.

## Inputs
- Current implementation in `lib/availability-cache.ts`
- Understanding that `selectDistributedAvailabilitySlots()` already filters past dates, but this is a second line of defense

## Work

### 1. Modify `getWorkspaceAvailabilitySlotsUtc()`

Location: `lib/availability-cache.ts` (around line 421-449)

Current code filters only booked slots:
```typescript
return {
  slotsUtc: cache.slotsUtc.filter((iso) => !bookedSet.has(iso)),
  // ...
};
```

Add a past-date filter **before** returning:
```typescript
const now = new Date();
const futureSlots = cache.slotsUtc
  .filter((iso) => !bookedSet.has(iso))
  .filter((iso) => new Date(iso).getTime() >= now.getTime());

return {
  slotsUtc: futureSlots,
  // ...
};
```

### 2. Add logging for stale cache detection

If the cache's `fetchedAt` is more than 1 hour old when accessed, log a warning:
```typescript
const cacheAgeMs = now.getTime() - (cache.fetchedAt?.getTime() || 0);
if (cacheAgeMs > 60 * 60 * 1000) {
  console.warn("[Availability] Stale cache accessed", {
    clientId,
    fetchedAt: cache.fetchedAt,
    cacheAgeMinutes: Math.round(cacheAgeMs / 60000),
  });
}
```

### 3. Verification
- `npm run lint`
- `npm run build`
- Manual test: create a cache with past dates, verify they're filtered out

## Output
- `lib/availability-cache.ts` updated with:
  - Past-date filter in `getWorkspaceAvailabilitySlotsUtc()` (lines 499-511)
  - Warning log when past/bad slots are stripped from cache result
  - Filter applied after booked-slot exclusion, before return

**Implementation Details:**
```typescript
const unbooked = cache.slotsUtc.filter((iso) => !bookedSet.has(iso));
const future = unbooked.filter((iso) => new Date(iso).getTime() >= now.getTime());

const removedPastOrBad = unbooked.length - future.length;
if (removedPastOrBad > 0) {
  console.warn("[Availability] Stripped past/bad slots from cache result", {
    clientId,
    removed: removedPastOrBad,
    remaining: future.length,
    fetchedAt: cache.fetchedAt.toISOString(),
    staleAt: cache.staleAt.toISOString(),
  });
}
```

**Status:** ✅ Complete (2026-01-27)

## Handoff
With the defensive filter in place, Phase 61b creates the dedicated cron endpoint to ensure caches stay fresh.
