# Phase 68d — Documentation and Help Text

## Focus
Add in-app documentation and help text to clarify follow-up trigger semantics.

## Inputs
- Phase 68a trigger inventory
- Phase 68b label resolver implementation

## Work
1. **Add help text to sequence manager**
   - Info section explaining trigger types:
     - **Cron triggers**: `no_response`, `meeting_selected` — checked periodically by background job
     - **Code triggers**: Built-in sequences may start automatically based on actions (e.g., sending an email)
     - **Manual**: Only triggered via admin action

2. **Add tooltips to trigger dropdown**
   - Each option gets a brief explanation
   - Example: "No response (after 24h): Starts when lead hasn't replied within 24 hours"

3. **Update sequence card descriptions**
   - Built-in sequences get clear descriptions:
     - "Meeting Requested": "Starts when you send your first reply. Sends reminder emails at Day 1, 2, 5, 7."
     - "Re-engagement Follow-up": "Activates for positive leads who stop responding. Requires prior conversation."

4. **Consider adding a "How it works" link**
   - Could link to external docs or show modal with detailed explanation

## Output

### Changes Made

**`components/dashboard/followup-sequence-manager.tsx`:**

1. **Added `HelpCircle` icon import**

2. **Added collapsible help section** (lines ~398-427):
   - Expandable "How do follow-up sequences work?" button
   - Explains trigger types:
     - **On setter email reply**: Meeting Requested auto-starts
     - **After meeting selected**: Post-Booking auto-starts
     - **Backfill only**: No Response is disabled
     - **Manual trigger**: Custom sequences started from CRM
   - Points users to CRM drawer for viewing active instances

3. **Tooltips already added in Phase 68b**:
   - Info icons on sequence cards show trigger explanations on hover
   - Built-in sequences show accurate labels ("On setter email reply" instead of "Manual trigger only")

### Verification

- `npm run lint`: 0 errors (18 pre-existing warnings)
- `npm run build`: Passes

## Handoff

→ **Phase 68e**: Review and cleanup. All documentation and help text is in place.
