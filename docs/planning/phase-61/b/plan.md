# Phase 61b — Create Dedicated `/api/cron/availability` Endpoint

## Focus
Create a dedicated cron endpoint for availability cache refresh, separate from the follow-ups cron. This enables independent scaling, monitoring, and a higher throughput target (100 workspaces/minute).

## Inputs
- Phase 61a: Past-date filter now in place as a safety net
- Current implementation in `app/api/cron/followups/route.ts`
- `refreshAvailabilityCachesDue()` from `lib/availability-cache.ts`

## Work

### 1. Create new endpoint file

Create: `app/api/cron/availability/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { refreshAvailabilityCachesDue } from "@/lib/availability-cache";

export const maxDuration = 60; // 1 minute max for availability refresh

/**
 * GET /api/cron/availability
 *
 * Dedicated cron for refreshing workspace availability caches.
 * Runs every minute to ensure fresh calendar data for AI drafts.
 *
 * Security: Requires Authorization: Bearer <CRON_SECRET> header
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get("Authorization");
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      console.warn("[Cron/Availability] CRON_SECRET not configured");
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }

    if (authHeader !== `Bearer ${expectedSecret}`) {
      console.warn("[Cron/Availability] Invalid authorization");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = Math.max(
      1,
      Math.min(500, Number.parseInt(process.env.AVAILABILITY_CRON_LIMIT || "100", 10) || 100)
    );

    console.log(`[Cron/Availability] Starting refresh (limit: ${limit})`);
    const startMs = Date.now();

    const result = await refreshAvailabilityCachesDue({ limit });

    const durationMs = Date.now() - startMs;
    console.log("[Cron/Availability] Complete", {
      ...result,
      durationMs,
    });

    return NextResponse.json({
      success: true,
      ...result,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Cron/Availability] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
```

### 2. Update default limit in environment

Change default from 20 to 100:
- In `app/api/cron/availability/route.ts`: default to 100
- In `app/api/cron/followups/route.ts`: can reduce to 0 (availability handled by dedicated cron)

### 3. (Optional) Remove availability from followups cron

Either:
- **Option A**: Set `AVAILABILITY_CRON_LIMIT=0` in followups to disable there
- **Option B**: Keep as backup (process any missed by dedicated cron)

Recommendation: **Option B** initially for safety, can remove later.

### 4. Verification
- `npm run lint`
- `npm run build`
- Manual test: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/availability`

## Output
- New file: `app/api/cron/availability/route.ts`
  - Advisory lock to prevent overlapping runs (`pg_try_advisory_lock`)
  - `mode: "all"` to refresh all configured workspaces
  - Configurable `timeBudgetMs` and `concurrency` via query params
  - Returns comprehensive metrics including staleness data
- `/api/cron/followups/route.ts` updated to skip availability refresh (comment on lines 48-49)

**Implementation Highlights:**
```typescript
const LOCK_KEY = BigInt("61061061061");

async function tryAcquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
  return Boolean(rows?.[0]?.locked);
}

// If lock held by another run:
if (!acquired) {
  return NextResponse.json({ success: true, skipped: true, reason: "locked", ... });
}
```

**Status:** ✅ Complete (2026-01-27)

## Handoff
Phase 61c adds staleness metrics to the response for monitoring. Phase 61d adds the cron schedule to `vercel.json`.
