# Phase 68c — Follow-Up Instance Visibility

## Focus
Add admin visibility to see which follow-up instances are active for a lead and their current state.

## Inputs
- `prisma/schema.prisma` — `FollowUpInstance` model
- `components/dashboard/inbox-view.tsx` — Lead detail panel
- `components/dashboard/crm-view.tsx` — Lead card/detail

## Work
1. **Create server action to fetch lead's follow-up instances**
   ```typescript
   // actions/followup-sequence-actions.ts
   async function getLeadFollowUpInstances(leadId: string): Promise<{
     success: boolean;
     data?: {
       sequenceName: string;
       status: string;
       currentStep: number;
       totalSteps: number;
       nextDueAt: Date | null;
       startedAt: Date;
       triggeredBy: string; // 'manual' | 'code' | 'cron'
     }[];
   }>
   ```

2. **Add follow-up status indicator to inbox**
   - Small badge or icon showing active follow-up count
   - Expandable panel showing instance details
   - Location: Lead detail sidebar or conversation header

3. **Add follow-up tab/section to CRM lead detail**
   - List of all follow-up instances (active and completed)
   - Show sequence name, current step, next action date
   - Allow manual pause/resume from this view

4. **Consider audit trail**
   - Log when instances are created and what triggered them
   - Display in instance detail view

## Output

### Discovery: Existing Implementation

**The follow-up instance visibility feature already exists!** It was implemented in a previous phase and is located in `components/dashboard/crm-drawer.tsx` (lines 983-1077).

**Existing capabilities:**
- Sequence name with status badge (active/paused/completed/cancelled)
- Step progress: "Step X/Y" with progress bar
- Next due date for active sequences
- Pause reason display (e.g., "Paused: Lead replied")
- Actions: Pause/Resume/Cancel buttons
- Manual sequence start dropdown

**Server action already exists:** `getLeadFollowUpInstances()` in `actions/followup-sequence-actions.ts` (line 541)

### Enhancement Made

**`components/dashboard/crm-drawer.tsx`** (line ~1010):
- Added "Started: {date}" to show when the sequence was triggered
- This addresses the user's question about "when things are triggered"

**Before:**
```
Step 1/4                    Next: 1/30/2026
```

**After:**
```
Step 1/4                    Started: 1/28/2026
Next: 1/30/2026
```

### Not Implemented (Future Enhancement)

The `FollowUpInstance` model doesn't have a `triggeredBy` field to track **how** the sequence was started (manual vs code vs cron). This would require:
1. Schema migration: Add `triggeredBy` field to `FollowUpInstance`
2. Update all sequence start paths to set this field
3. Update UI to display trigger source

Recommended for a future phase if detailed audit trail is needed.

### Verification

- `npm run lint`: 0 errors (18 pre-existing warnings)
- `npm run build`: Passes

## Handoff

→ **Phase 68d**: Documentation and help text. Instance visibility is now enhanced with start date display. The core visibility feature was already in place.
