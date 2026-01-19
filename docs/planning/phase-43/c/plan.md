# Phase 43c — Lead Assignment Logic (`lib/lead-assignment.ts`)

## Focus
Create the core round-robin assignment logic that determines when leads should be assigned and executes atomic assignment operations.

## Inputs
- Database fields from Phase 43a (`Lead.assignedToUserId`, `WorkspaceSettings.roundRobinEnabled`)
- Setter accounts from Phase 43b (exist in `ClientMember` with role SETTER)
- Existing sentiment classification system (sentimentTag values)

## Work

### 1. Create `lib/lead-assignment.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { ClientMemberRole } from "@prisma/client";

/**
 * Sentiment tags that trigger lead assignment
 */
const ASSIGNMENT_TRIGGER_SENTIMENTS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Interested",
] as const;

/**
 * Check if a sentiment tag should trigger lead assignment
 */
export function shouldAssignLead(sentimentTag: string | null): boolean {
  if (!sentimentTag) return false;
  return ASSIGNMENT_TRIGGER_SENTIMENTS.includes(sentimentTag as any);
}

/**
 * Get active setters for a workspace, sorted deterministically by userId
 */
async function getActiveSetters(clientId: string) {
  return prisma.clientMember.findMany({
    where: {
      clientId,
      role: ClientMemberRole.SETTER,
    },
    orderBy: { userId: "asc" }, // Deterministic order
    select: { userId: true, email: true },
  });
}

/**
 * Assign a lead to the next setter in round-robin rotation.
 * Uses atomic transaction to update both lead and workspace settings.
 *
 * @returns The assigned setter's userId, or null if assignment skipped
 */
export async function assignLeadRoundRobin({
  leadId,
  clientId,
}: {
  leadId: string;
  clientId: string;
}): Promise<string | null> {
  // 1. Check if round-robin is enabled
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { roundRobinEnabled: true, roundRobinLastSetterIndex: true },
  });

  if (!settings?.roundRobinEnabled) {
    return null; // Round-robin not enabled for this workspace
  }

  // 2. Get active setters
  const setters = await getActiveSetters(clientId);
  if (setters.length === 0) {
    console.warn(`[LeadAssignment] No active setters for client ${clientId}`);
    return null;
  }

  // 3. Calculate next setter index
  const lastIndex = settings.roundRobinLastSetterIndex ?? -1;
  const nextIndex = (lastIndex + 1) % setters.length;
  const nextSetter = setters[nextIndex];

  // 4. Atomic transaction: assign lead + update index
  const now = new Date();

  await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: {
        assignedToUserId: nextSetter.userId,
        assignedAt: now,
      },
    }),
    prisma.workspaceSettings.update({
      where: { clientId },
      data: { roundRobinLastSetterIndex: nextIndex },
    }),
  ]);

  console.log(
    `[LeadAssignment] Assigned lead ${leadId} to ${nextSetter.email} (index ${nextIndex})`
  );

  return nextSetter.userId;
}

/**
 * Bulk assign unassigned interested leads (for backfill).
 * Processes leads one at a time to maintain round-robin fairness.
 */
export async function backfillLeadAssignments(clientId: string): Promise<{
  assigned: number;
  skipped: number;
}> {
  const unassignedLeads = await prisma.lead.findMany({
    where: {
      clientId,
      assignedToUserId: null,
      sentimentTag: { in: [...ASSIGNMENT_TRIGGER_SENTIMENTS] },
    },
    orderBy: { lastInboundAt: "desc" },
    select: { id: true },
  });

  let assigned = 0;
  let skipped = 0;

  for (const lead of unassignedLeads) {
    const result = await assignLeadRoundRobin({ leadId: lead.id, clientId });
    if (result) {
      assigned++;
    } else {
      skipped++;
    }
  }

  console.log(
    `[LeadAssignment] Backfill complete for ${clientId}: ${assigned} assigned, ${skipped} skipped`
  );

  return { assigned, skipped };
}
```

### 2. Key design decisions

1. **Deterministic setter order:** Setters are sorted by `userId` (ascending) to ensure consistent rotation order regardless of when they were added.

2. **Atomic transaction:** Lead assignment and index update happen in a single transaction to prevent race conditions with concurrent assignments.

3. **Null-safe index:** If `roundRobinLastSetterIndex` is null (first assignment), defaults to `-1` so `(-1 + 1) % n = 0` starts with the first setter.

4. **No retry on setter change:** If a setter is removed, the index continues from where it was. New assignments skip removed setters naturally (they're not in the active list).

### 3. Verify TypeScript compilation

```bash
npx tsc --noEmit
```

## Output
- New file: `lib/lead-assignment.ts`
- Exports:
  - `shouldAssignLead(sentimentTag)` — checks if sentiment triggers assignment
  - `assignLeadRoundRobin({ leadId, clientId })` — atomic round-robin assignment
  - `maybeAssignLead({ leadId, clientId, sentimentTag })` — convenience wrapper for background jobs
  - `backfillLeadAssignments(clientId)` — bulk assignment for existing leads
- Key design decisions:
  - Uses `createdAt ASC` ordering for setters (matches Vanessa → David → Jon creation order)
  - Interactive transaction with `updateMany WHERE assignedToUserId IS NULL` for idempotency
  - Pointer only advances when assignment actually happens
  - Reuses `isPositiveSentiment()` from `lib/sentiment-shared.ts` for consistency
- TypeScript compiles without errors (`npx tsc --noEmit`)

## Handoff
Core assignment logic is ready. Proceed to Phase 43d to integrate with background job post-processors.
