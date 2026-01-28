# Phase 68b — Update Sequence Card Trigger Labels

## Focus
Fix the sequence card display to show accurate trigger descriptions for built-in sequences.

## Inputs
- Phase 68a inventory
- `components/dashboard/followup-sequence-manager.tsx`
- `actions/followup-sequence-actions.ts` — `DEFAULT_SEQUENCE_NAMES`

## Work
1. **Create trigger label resolver**
   - Add helper function to resolve display label based on sequence name + triggerOn
   - Built-in sequences get custom labels:
     - "Meeting Requested" → "On setter email reply"
     - "Re-engagement Follow-up" → "After 24h no response (positive leads)"
     - "Post-Booking" → "After meeting selected"

2. **Update sequence card display**
   - Replace direct `TRIGGER_OPTIONS.find()` with label resolver
   - Ensure both collapsed and expanded views use consistent labels

3. **Add tooltip or info icon**
   - Explain trigger behavior on hover
   - Example: "This sequence starts automatically when you send your first email reply to a lead"

4. **Preserve edit dialog behavior**
   - Keep existing dropdown for custom sequences
   - Consider making trigger read-only for built-in sequences (since code controls it)

## Output

### Changes Made

**`components/dashboard/followup-sequence-manager.tsx`:**

1. **Added `Info` icon import** from lucide-react

2. **Added `BUILT_IN_TRIGGER_OVERRIDES` map** (lines ~82-93):
   ```typescript
   const BUILT_IN_TRIGGER_OVERRIDES: Record<string, { label: string; tooltip: string }> = {
     "Meeting Requested Day 1/2/5/7": {
       label: "On setter email reply",
       tooltip: "Starts automatically when you send your first email reply to this lead",
     },
     "No Response Day 2/5/7": {
       label: "Backfill only",
       tooltip: "Auto-start disabled. Only applies via manual backfill for positive leads who stopped responding.",
     },
   };
   ```

3. **Added `getTriggerDisplay()` helper** (lines ~95-107):
   - Returns accurate label for built-in sequences
   - Falls back to standard `TRIGGER_OPTIONS` lookup for custom sequences
   - Includes `isBuiltIn` flag for downstream logic

4. **Updated sequence card display** (line ~440):
   - Now uses `getTriggerDisplay()` instead of direct `TRIGGER_OPTIONS.find()`
   - Shows Info icon with tooltip for built-in sequences

5. **Updated edit dialog trigger field** (lines ~620-655):
   - Built-in sequences show read-only trigger display with "(system-controlled)" label
   - Custom sequences retain the editable dropdown

### Verification

- `npm run lint`: 0 errors (18 pre-existing warnings)
- `npm run build`: Passes

## Handoff

→ **Phase 68c**: Add follow-up instance visibility to inbox/CRM. The trigger clarity work is complete; users can now see accurate trigger labels and understand that built-in sequences are system-controlled.
