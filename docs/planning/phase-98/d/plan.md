# Phase 98d — Followups Cron Backstop + Tests

## Focus
Add a hard backstop so the followups cron completes any non-post-booking sequences for leads that are already `meeting-booked`, and add tests/registrations.

## Inputs
- Phase 98c changes (side effects on all booking transitions)
- Followups cron: `app/api/cron/followups/route.ts` (modified by Phase 97 with advisory locking)
- Followup engine: `lib/followup-engine.ts`
- Test runner: `scripts/test-orchestrator.ts` (modified by Phase 97)

## Work

### Step 1: Implement cron backstop helper

File: `lib/followup-engine.ts`

Add a new exported function at the end of the file:

```ts
/**
 * Cron backstop: complete any active/paused non-post-booking sequences
 * for leads that are already "meeting-booked".
 *
 * This catches edge cases where a lead was marked booked but the side-effect
 * path didn't complete instances (e.g., manual status change, race condition).
 *
 * Phase 98d: Run early in followups cron to guarantee SLA.
 */
export async function completeFollowUpsForMeetingBookedLeads(): Promise<{
  completedCount: number;
}> {
  try {
    // Find instances that should be completed
    const result = await prisma.followUpInstance.updateMany({
      where: {
        status: { in: ["active", "paused"] },
        sequence: { triggerOn: { not: "meeting_selected" } },
        lead: { status: "meeting-booked" },
      },
      data: {
        status: "completed",
        completedAt: new Date(),
        nextStepDue: null,
      },
    });

    if (result.count > 0) {
      console.log(`[Backstop] Completed ${result.count} orphaned instances for meeting-booked leads`);
    }

    return { completedCount: result.count };
  } catch (error) {
    console.error("[Backstop] Failed to complete follow-ups for meeting-booked leads:", error);
    return { completedCount: 0 };
  }
}
```

### Step 2: Call the backstop early in `runFollowupsCron()`

File: `app/api/cron/followups/route.ts`

1. Import the new helper:
   ```ts
   import {
     processFollowUpsDue,
     resumeAwaitingEnrichmentFollowUps,
     resumeGhostedFollowUps,
     resumeSnoozedFollowUps,
     completeFollowUpsForMeetingBookedLeads, // Add this
   } from "@/lib/followup-engine";
   ```

2. Add the backstop call at the START of `runFollowupsCron()`, after the schema compatibility check (around line 78):
   ```ts
   // Phase 98d: Backstop - complete orphaned instances for booked leads
   let backstop: unknown = null;
   console.log("[Cron] Running booking backstop...");
   try {
     backstop = await completeFollowUpsForMeetingBookedLeads();
     console.log("[Cron] Booking backstop complete:", backstop);
   } catch (error) {
     if (isPrismaMissingTableOrColumnError(error)) {
       return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
     }
     errors.push(`completeFollowUpsForMeetingBookedLeads: ${error instanceof Error ? error.message : String(error)}`);
     console.error("[Cron] Failed to run booking backstop:", error);
   }
   ```

3. Include `backstop` in the response JSON (add after `notificationDigests`):
   ```ts
   return NextResponse.json(
     {
       success,
       errors,
       backstop, // Add this
       snoozed,
       resumed,
       // ... rest
     },
     { status: success ? 200 : 500 }
   );
   ```

### Step 3: Add unit tests

File: `lib/__tests__/followups-backstop.test.ts` (new)

Use dependency injection (pass a stubbed prisma client) instead of module mocking to keep Node test runner requirements minimal.

### Step 4: Register the new test file(s) in `scripts/test-orchestrator.ts`

**Important:** Merge with existing Phase 97 edits (do not clobber the TEST_FILES array).

Add to `TEST_FILES` array:
```ts
"lib/__tests__/followups-backstop.test.ts",
"lib/__tests__/appointment-reconcile-eligibility.test.ts",
```

Current array (from Phase 97) includes:
- `lib/__tests__/followups-cron-overlap-lock.test.ts`
- `lib/__tests__/offered-slots-refresh.test.ts`

After merge, array should include all Phase 97 + Phase 98 tests.

## Output
- `lib/followup-engine.ts` exports `completeFollowUpsForMeetingBookedLeads()`
- `app/api/cron/followups/route.ts` calls backstop early in cron execution
- Followups cron guarantees that booked leads cannot keep active non-post-booking sequences for more than one cron interval
- Tests covering backstop behavior are in the suite

### Completed
- Added `completeFollowUpsForMeetingBookedLeads()` (with injectable prisma client for tests).
- Wired the backstop into `runFollowupsCron()` and included `backstop` in the cron response payload.
- Added `lib/__tests__/followups-backstop.test.ts` and registered it in `scripts/test-orchestrator.ts`.

## Coordination Notes
**Integrated from Phase 97:** `app/api/cron/followups/route.ts` already had advisory locking; backstop runs inside the lock and after schema compatibility checks.  
**Files affected:** `app/api/cron/followups/route.ts`, `scripts/test-orchestrator.ts`

## Validation (RED TEAM)
- Run `npm run test` to verify all tests pass (including new backstop tests).
- Run `npm run lint` to verify no lint errors.
- Run `npm run build` to verify TypeScript compiles.
- Manually verify `scripts/test-orchestrator.ts` includes both Phase 97 and Phase 98 test files.

## Handoff
Proceed to Phase 98e for verification steps (lint/build), environment configuration, and rollout/monitoring notes.
