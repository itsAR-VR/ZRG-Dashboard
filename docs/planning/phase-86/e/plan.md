# Phase 86e — Cron Endpoint + Vercel Schedule (ET Anchored Weekly)

## Focus
Create a new cron API route that runs the calendar health check weekly (Sunday 6pm ET), protected by `CRON_SECRET` and an advisory lock.

## Inputs
- Cron auth pattern: `app/api/cron/availability/route.ts:10-22` — `isAuthorized()` checks `Authorization: Bearer ${CRON_SECRET}` + `x-cron-secret` fallback.
- Advisory lock pattern: `app/api/cron/availability/route.ts:24-33` — `tryAcquireLock()` + `releaseLock()` with unique BigInt key.
- Runner: `runCalendarHealthCheck()` from Phase 86c.
- Notifier: `sendCalendarHealthAlerts()` from Phase 86d.
- Vercel cron config: `vercel.json` (8 existing entries).

## Work
1. Create `app/api/cron/calendar-health/route.ts`:
   ```typescript
   import { NextRequest, NextResponse } from "next/server";
   import { prisma } from "@/lib/prisma";
   import { runCalendarHealthCheck } from "@/lib/calendar-health-runner";
   import { sendCalendarHealthAlerts } from "@/lib/calendar-health-notifier";

   export const maxDuration = 60;

   function isAuthorized(request: NextRequest): boolean {
     const expectedSecret = process.env.CRON_SECRET;
     if (!expectedSecret) {
       console.warn("[Cron/CalendarHealth] CRON_SECRET not configured");
       return false;
     }
     const authHeader = request.headers.get("Authorization");
     const legacy = request.headers.get("x-cron-secret");
     return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
   }

   // Unique lock key for calendar health cron
   const LOCK_KEY = BigInt("86086086086");

   async function tryAcquireLock(): Promise<boolean> {
     const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
       SELECT pg_try_advisory_lock(${LOCK_KEY}) as locked
     `;
     return Boolean(rows?.[0]?.locked);
   }

   async function releaseLock(): Promise<void> {
     await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
   }
   ```
2. Implement time window check:
   ```typescript
   function isWithinWeeklyWindow(now: Date): boolean {
     // Convert to America/New_York
     const formatter = new Intl.DateTimeFormat('en-US', {
       timeZone: 'America/New_York',
       weekday: 'short',
       hour: 'numeric',
       hour12: false,
     });
     const parts = formatter.formatToParts(now);
     const weekday = parts.find(p => p.type === 'weekday')?.value; // "Sun"
     const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
     return weekday === 'Sun' && hour === 18;
   }
   ```
3. GET handler:
   ```typescript
   export async function GET(request: NextRequest) {
     if (!isAuthorized(request)) {
       return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
     }

     const now = new Date();
     const clientId = request.nextUrl.searchParams.get("clientId");
     const forceRun = request.nextUrl.searchParams.get("force") === "true";

     // Skip if outside window (unless debug mode)
     if (!forceRun && !clientId && !isWithinWeeklyWindow(now)) {
       return NextResponse.json({
         success: true,
         skipped: true,
         reason: "outside_window",
         timestamp: now.toISOString(),
       });
     }

     const acquired = await tryAcquireLock();
     if (!acquired) {
       return NextResponse.json({
         success: true,
         skipped: true,
         reason: "locked",
         timestamp: now.toISOString(),
       });
     }

     try {
       const results = await runCalendarHealthCheck({ clientId: clientId || undefined });
       const alertSummary = await sendCalendarHealthAlerts(results, now);

       return NextResponse.json({
         success: true,
         timestamp: now.toISOString(),
         workspacesChecked: results.length,
         calendarsEvaluated: results.reduce((sum, r) => sum + r.calendars.length, 0),
         calendarsBelowThreshold: results.reduce(
           (sum, r) => sum + r.calendars.filter(c => c.isBelowThreshold).length, 0
         ),
         alertsSent: alertSummary.sent,
         alertsSkipped: alertSummary.skipped,
         errors: [...results.flatMap(r => r.errors), ...alertSummary.errors],
       });
     } finally {
       await releaseLock();
     }
   }
   ```
4. Update `vercel.json` — add new cron entry:
   ```json
   {
     "path": "/api/cron/calendar-health",
     "schedule": "0 * * * *"
   }
   ```
   - Runs hourly; route's time window check ensures execution only on Sunday 6pm ET.

## Validation (RED TEAM)
- Test with `?force=true` to run outside window.
- Test with `?clientId=xxx` to run for single workspace.
- Verify 401 response without proper auth header.
- Verify `locked` skip when concurrent request attempts.
- Verify response structure matches spec.

## Output
- Added `app/api/cron/calendar-health/route.ts`:
  - Auth via `CRON_SECRET` (Authorization bearer + `x-cron-secret` fallback)
  - Postgres advisory lock (unique `LOCK_KEY`)
  - ET gating: runs only when ET is Sunday 18:00 unless `?force=1`
  - Supports `?clientId=...`, `?concurrency=...`, `?timeBudgetMs=...`
  - Calls `runCalendarHealthChecks(...)` then `sendWeeklyCalendarHealthSlackAlerts(...)`
- Updated `vercel.json` to call `/api/cron/calendar-health` hourly (`0 * * * *`) so DST is handled by in-route gating.

## Handoff
- Proceed to Phase 86f: wire `calendarHealthEnabled` + `calendarHealthMinSlots` into `actions/settings-actions.ts` and `components/dashboard/settings-view.tsx`, then add unit tests for `countSlotsInWorkspaceWindow`.

## Assumptions / Open Questions (RED TEAM)
- **Assumption:** Hourly cron with in-route time check is acceptable (alternatives: weekly cron, external scheduler) (~95% confidence)
  - Rationale: Handles DST automatically; hourly overhead is negligible.
- **Assumption:** Lock key `86086086086` is unique and doesn't collide with other crons (~99% confidence)
  - Verified: Other crons use different keys (e.g., `61061061061` for availability).
- **Assumption:** `maxDuration = 60` is sufficient for all workspaces (~85% confidence)
  - Mitigation: Time budget in runner prevents overrun; can increase to 120 if needed.
