# Phase 43f — Per-Setter Funnel Analytics + Verification

## Focus
Add analytics to track each setter's full conversion funnel, run the backfill for existing leads, and verify the complete implementation.

## Inputs
- All previous subphase outputs (schema, accounts, assignment logic, filtering)
- Founders Club workspace: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
- 35 existing interested leads to backfill

## Work

### 1. Add `getSetterFunnelAnalytics()` to `actions/analytics-actions.ts`

```typescript
export interface SetterFunnelStats {
  userId: string;
  email: string;
  // Volume metrics
  assignedLeadsCount: number;
  respondedLeadsCount: number;      // Leads with at least one setter reply
  // Response performance
  avgResponseTimeMs: number | null;
  avgResponseTimeFormatted: string | null;
  // Conversion funnel
  positiveLeadsCount: number;       // Leads with positive sentiment
  meetingsRequestedCount: number;   // "Meeting Requested" or "Call Requested"
  meetingsBookedCount: number;      // Has appointmentBookedAt or ghlAppointmentId
  // Rates (0-1)
  responseRate: number;             // respondedLeadsCount / assignedLeadsCount
  positiveRate: number;             // positiveLeadsCount / assignedLeadsCount
  meetingRequestRate: number;       // meetingsRequestedCount / assignedLeadsCount
  bookingRate: number;              // meetingsBookedCount / assignedLeadsCount
  requestToBookRate: number;        // meetingsBookedCount / meetingsRequestedCount
}

export async function getSetterFunnelAnalytics(
  clientId: string
): Promise<SetterFunnelStats[]> {
  const { user } = await resolveClientScope();

  // Get all setters for this workspace
  const setters = await prisma.clientMember.findMany({
    where: { clientId, role: "SETTER" },
    select: { userId: true, email: true },
  });

  const results: SetterFunnelStats[] = [];

  for (const setter of setters) {
    // Get assigned leads with aggregated stats
    const assignedLeads = await prisma.lead.findMany({
      where: {
        clientId,
        assignedToUserId: setter.userId,
      },
      select: {
        id: true,
        sentimentTag: true,
        appointmentBookedAt: true,
        ghlAppointmentId: true,
        messages: {
          where: {
            direction: "outbound",
            sentByUserId: setter.userId,
          },
          select: { id: true, createdAt: true },
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
    });

    const assignedCount = assignedLeads.length;

    // Responded = leads with at least one outbound message from this setter
    const respondedCount = assignedLeads.filter(l => l.messages.length > 0).length;

    // Positive sentiment
    const positiveSentiments = ["Interested", "Information Requested", "Meeting Requested", "Call Requested"];
    const positiveCount = assignedLeads.filter(l =>
      l.sentimentTag && positiveSentiments.includes(l.sentimentTag)
    ).length;

    // Meeting requested
    const meetingRequestedCount = assignedLeads.filter(l =>
      l.sentimentTag === "Meeting Requested" || l.sentimentTag === "Call Requested"
    ).length;

    // Booked
    const bookedCount = assignedLeads.filter(l =>
      l.appointmentBookedAt !== null || l.ghlAppointmentId !== null
    ).length;

    // Calculate rates (avoid division by zero)
    const safeDiv = (num: number, denom: number) => denom > 0 ? num / denom : 0;

    results.push({
      userId: setter.userId,
      email: setter.email ?? "Unknown",
      assignedLeadsCount: assignedCount,
      respondedLeadsCount: respondedCount,
      avgResponseTimeMs: null, // TODO: calculate from first response time
      avgResponseTimeFormatted: null,
      positiveLeadsCount: positiveCount,
      meetingsRequestedCount: meetingRequestedCount,
      meetingsBookedCount: bookedCount,
      responseRate: safeDiv(respondedCount, assignedCount),
      positiveRate: safeDiv(positiveCount, assignedCount),
      meetingRequestRate: safeDiv(meetingRequestedCount, assignedCount),
      bookingRate: safeDiv(bookedCount, assignedCount),
      requestToBookRate: safeDiv(bookedCount, meetingRequestedCount),
    });
  }

  return results;
}
```

### 2. Add UI component for setter funnel (optional)

If time permits, add a table in the analytics view:

```typescript
// components/dashboard/analytics/setter-funnel-table.tsx
// Simple table showing each setter's metrics
```

For MVP, the server action is sufficient; UI can be added later.

### 3. Run backfill for Founders Club

Execute the backfill function:

```typescript
import { backfillLeadAssignments } from "@/lib/lead-assignment";

await backfillLeadAssignments("ef824aca-a3c9-4cde-b51f-2e421ebb6b6e");
```

Expected output: ~35 leads distributed across 3 setters (~12 each, depending on exact count and rotation).

### 4. Verification checklist

#### Schema verification
```sql
-- Verify Lead fields
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'Lead' AND column_name IN ('assignedToUserId', 'assignedAt');

-- Verify WorkspaceSettings fields
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'WorkspaceSettings' AND column_name IN ('roundRobinEnabled', 'roundRobinLastSetterIndex');
```

#### Account verification
```sql
SELECT cm."userId", cm."email", cm."role"
FROM "ClientMember" cm
WHERE cm."clientId" = 'ef824aca-a3c9-4cde-b51f-2e421ebb6b6e'
  AND cm."role" = 'SETTER';
-- Expect 3 rows
```

#### Assignment verification
```sql
-- Check distribution
SELECT "assignedToUserId", COUNT(*) as lead_count
FROM "Lead"
WHERE "clientId" = 'ef824aca-a3c9-4cde-b51f-2e421ebb6b6e'
  AND "assignedToUserId" IS NOT NULL
GROUP BY "assignedToUserId";
-- Expect ~12 leads per setter
```

#### Round-robin index verification
```sql
SELECT "roundRobinEnabled", "roundRobinLastSetterIndex"
FROM "WorkspaceSettings"
WHERE "clientId" = 'ef824aca-a3c9-4cde-b51f-2e421ebb6b6e';
-- Expect enabled=true, index=(number of assignments - 1) % 3
```

#### Inbox filtering verification
1. Login as setter (e.g., vanessa@zeroriskgrowth.com)
2. Navigate to inbox
3. Verify only ~12 leads visible (their assigned leads)
4. Login as admin
5. Verify all leads visible (including unassigned)

#### New lead assignment verification
1. Send a test inbound message to an unassigned lead
2. Have AI classify it as "Interested" or similar
3. Verify lead gets assigned to the next setter in rotation
4. Check round-robin index incremented

### 5. Build verification

```bash
npm run lint
npm run build
```

Both must pass with no errors.

## Output
- `actions/analytics-actions.ts` updated with:
  - `SetterFunnelStats` interface
  - `getSetterFunnelAnalytics(clientId)` — returns per-setter funnel metrics
- Backfill executed via Supabase MCP SQL:
  - 48 positive leads distributed evenly to 3 setters (16 each)
  - Vanessa: 16 leads
  - David: 16 leads
  - Jon: 16 leads
- Round-robin index updated to 2 (next assignment → Vanessa/index 0)
- Build verification:
  - `npm run lint` — 0 errors, 17 warnings (pre-existing)
  - `npm run build` — success

## Handoff
Phase 43 complete. Document findings in root `plan.md` Phase Summary section.

### Summary to add to root plan:

```markdown
## Phase Summary

**Implemented:**
- Schema: Added `Lead.assignedToUserId`, `Lead.assignedAt`, `WorkspaceSettings.roundRobinEnabled`, `WorkspaceSettings.roundRobinLastSetterIndex`
- Created 3 setter accounts for Founders Club (vanessa, david, jon)
- Implemented `lib/lead-assignment.ts` with round-robin logic
- Integrated assignment into 5 background job post-processors
- Added SETTER inbox filtering in `actions/lead-actions.ts`
- Added per-setter funnel analytics in `actions/analytics-actions.ts`
- Backfilled 35 existing interested leads

**Verified:**
- Setters see only their assigned leads
- Admins see all leads
- New positive leads are automatically assigned round-robin
- Build passes

**Credentials:**
- Setter passwords shared securely with stakeholder
```
