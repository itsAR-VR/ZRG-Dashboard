# Phase 43d — Background Job Integration (5 Post-Processors)

## Focus
Hook lead assignment into all 5 background job post-processors so that leads are automatically assigned after sentiment classification.

## Inputs
- Assignment logic from Phase 43c (`shouldAssignLead`, `assignLeadRoundRobin`)
- Existing background job files in `lib/background-jobs/`

## Work

### 1. Files to modify

| File | Channel |
|------|---------|
| `lib/background-jobs/sms-inbound-post-process.ts` | SMS (GoHighLevel) |
| `lib/background-jobs/linkedin-inbound-post-process.ts` | LinkedIn (Unipile) |
| `lib/background-jobs/smartlead-inbound-post-process.ts` | Email (SmartLead) |
| `lib/background-jobs/instantly-inbound-post-process.ts` | Email (Instantly) |
| `lib/background-jobs/email-inbound-post-process.ts` | Email (Legacy/Inboxxia) |

### 2. Integration pattern

For each file, add after sentiment classification:

```typescript
import { shouldAssignLead, assignLeadRoundRobin } from "@/lib/lead-assignment";

// After sentiment update (where sentimentTag is determined)...

// Assign lead if newly positive (and not already assigned)
const wasAlreadyAssigned = lead.assignedToUserId !== null;
if (!wasAlreadyAssigned && shouldAssignLead(sentimentTag)) {
  await assignLeadRoundRobin({ leadId: lead.id, clientId: client.id });
}
```

### 3. Implementation notes per file

#### `sms-inbound-post-process.ts`
- Location: After `updateLeadSentiment()` call (around line where sentiment is updated)
- Lead variable: `lead` from initial fetch
- Client variable: `client` from initial fetch

#### `linkedin-inbound-post-process.ts`
- Location: After sentiment classification step
- Lead variable: `lead` from initial fetch
- Client variable: `client` from initial fetch

#### `smartlead-inbound-post-process.ts`
- Location: After sentiment update (may use `resolvedLead`)
- Note: SmartLead already has complex flow; insert after sentiment is determined

#### `instantly-inbound-post-process.ts`
- Location: After sentiment update
- Similar structure to SmartLead

#### `email-inbound-post-process.ts`
- Location: After sentiment classification
- May need to fetch fresh lead state if sentiment was updated separately

### 4. Re-fetch lead if needed

If the background job updates sentiment via a separate function that doesn't return the updated lead, re-fetch:

```typescript
// Get current lead state (in case sentiment was updated)
const currentLead = await prisma.lead.findUnique({
  where: { id: lead.id },
  select: { assignedToUserId: true, sentimentTag: true },
});

if (currentLead && !currentLead.assignedToUserId && shouldAssignLead(currentLead.sentimentTag)) {
  await assignLeadRoundRobin({ leadId: lead.id, clientId: client.id });
}
```

### 5. Verify no duplicate assignments

The `assignLeadRoundRobin` function only assigns if `assignedToUserId` is null (checked by caller). If somehow called twice concurrently:
- First call wins (updates lead)
- Second call's transaction will update an already-assigned lead (harmless but wasteful)

For production robustness, add a conditional check inside the transaction:

```typescript
// In assignLeadRoundRobin, add conditional update:
prisma.lead.updateMany({
  where: {
    id: leadId,
    assignedToUserId: null, // Only if still unassigned
  },
  data: {
    assignedToUserId: nextSetter.userId,
    assignedAt: now,
  },
}),
```

### 6. Test with existing leads

After implementation, trigger a background job for an existing unassigned interested lead and verify:
- Lead gets `assignedToUserId` populated
- `WorkspaceSettings.roundRobinLastSetterIndex` increments

## Output
- 5 background job files modified with assignment hook:
  - `lib/background-jobs/sms-inbound-post-process.ts` — after step 3 (sentiment classification)
  - `lib/background-jobs/linkedin-inbound-post-process.ts` — after step 2 (sentiment classification)
  - `lib/background-jobs/smartlead-inbound-post-process.ts` — after step 3 (sentiment update)
  - `lib/background-jobs/instantly-inbound-post-process.ts` — after step 3 (sentiment update)
  - `lib/background-jobs/email-inbound-post-process.ts` — after AI classification block
- All use `maybeAssignLead()` which internally checks:
  - Is sentiment positive? (via `shouldAssignLead`)
  - Is round-robin enabled for workspace?
  - Is lead already assigned?
- TypeScript compiles without errors (`npx tsc --noEmit`)

## Handoff
Background jobs now assign leads. Proceed to Phase 43e to implement inbox filtering for SETTER role.
