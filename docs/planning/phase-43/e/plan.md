# Phase 43e — Inbox Filtering for SETTER Role

## Focus
Modify the inbox/conversation queries so setters only see their assigned leads, while admins and owners see all leads.

## Inputs
- Assignment fields on Lead model (`assignedToUserId`)
- Existing conversation fetch logic in `actions/lead-actions.ts`
- Existing workspace access helpers in `lib/workspace-access.ts`

## Work

### 1. Add role helper to `lib/workspace-access.ts`

```typescript
import { ClientMemberRole } from "@prisma/client";

/**
 * Get the user's role for a specific workspace.
 * Returns "OWNER" if user owns the workspace, or the ClientMember role if member.
 */
export async function getUserRoleForClient(
  userId: string,
  clientId: string
): Promise<ClientMemberRole | "OWNER" | null> {
  // Check if user is the workspace owner
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { userId: true },
  });

  if (client?.userId === userId) {
    return "OWNER";
  }

  // Check if user is a member
  const member = await prisma.clientMember.findUnique({
    where: {
      clientId_userId: { clientId, userId },
    },
    select: { role: true },
  });

  return member?.role ?? null;
}
```

### 2. Modify `getConversationsCursor()` in `actions/lead-actions.ts`

Add SETTER filtering:

```typescript
import { getUserRoleForClient } from "@/lib/workspace-access";

export async function getConversationsCursor(/* ... params */) {
  const { user, clientId } = await resolveClientScope();

  // Build base where conditions
  const whereConditions: Prisma.LeadWhereInput[] = [
    { clientId },
    // ... existing filters (channel, sentiment, search, etc.)
  ];

  // SETTER role: only see assigned leads
  const userRole = await getUserRoleForClient(user.id, clientId);
  if (userRole === "SETTER") {
    whereConditions.push({ assignedToUserId: user.id });
  }
  // ADMIN, INBOX_MANAGER, OWNER: see all leads (no filter)

  const where: Prisma.LeadWhereInput = {
    AND: whereConditions,
  };

  // ... rest of query
}
```

### 3. Include `assignedToUserId` in returned Lead data

Ensure the conversation query includes `assignedToUserId` so UI can display assignment info:

```typescript
const leads = await prisma.lead.findMany({
  where,
  select: {
    // ... existing fields
    assignedToUserId: true,
    assignedAt: true,
  },
  // ... orderBy, take, cursor
});
```

### 4. Verify filtering in `getInboxCounts()`

If `getInboxCounts()` is used for navigation badges, apply the same SETTER filter:

```typescript
export async function getInboxCounts() {
  const { user, clientId } = await resolveClientScope();

  const userRole = await getUserRoleForClient(user.id, clientId);
  const setterFilter = userRole === "SETTER"
    ? { assignedToUserId: user.id }
    : {};

  const counts = await prisma.lead.groupBy({
    by: ["sentimentTag"],
    where: {
      clientId,
      ...setterFilter,
    },
    _count: true,
  });
  // ...
}
```

### 5. Update related queries

Search any other lead queries in `actions/lead-actions.ts` and apply the same pattern:
- `getLeadById()` — Verify setter can access (either their assigned lead OR admin)
- `getConversationMessages()` — Inherits from lead access check
- Any export/reporting queries

### 6. Test scenarios

| Scenario | Expected Result |
|----------|-----------------|
| SETTER views inbox | Only sees leads where `assignedToUserId = their userId` |
| ADMIN views inbox | Sees all leads (assigned + unassigned) |
| OWNER views inbox | Sees all leads |
| INBOX_MANAGER views inbox | Sees all leads |
| SETTER searches for unassigned lead | No results (filtered out) |
| SETTER clicks direct link to unassigned lead | Access denied or redirect |

## Output
- `lib/workspace-access.ts` updated with:
  - `getUserRoleForClient(userId, clientId)` — returns "OWNER" | ClientMemberRole | null
  - `isSetterRole(role)` — helper to check if role should filter assigned leads only
  - `UserRole` type and `ROLE_PRECEDENCE` map for multi-role handling
- `actions/lead-actions.ts` updated with:
  - `getInboxCounts()` — SETTER filter applied to raw SQL and Prisma counts
  - `getConversationsCursor()` — SETTER filter added to whereConditions
  - `ConversationData.lead` interface extended with `assignedToUserId` and `assignedAt`
  - All 3 return sites updated to include assignment fields
- TypeScript compiles without errors

## Handoff
Inbox filtering complete. Proceed to Phase 43f to add per-setter funnel analytics and run backfill + verification.
