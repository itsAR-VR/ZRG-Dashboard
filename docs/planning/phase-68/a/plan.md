# Phase 68a — Audit Trigger Display Logic

## Focus
Understand current trigger display implementation and identify gaps between UI labels and actual behavior.

## Inputs
- `components/dashboard/followup-sequence-manager.tsx` — Trigger dropdown and display
- `lib/followup-automation.ts` — Code-based trigger functions
- `actions/followup-sequence-actions.ts` — Built-in sequence creation logic
- `prisma/schema.prisma` — `FollowUpSequence.triggerOn` field

## Work
1. **Map trigger display logic**
   - Document where `triggerOn` is displayed (sequence card, edit dialog)
   - Identify hardcoded trigger labels in `TRIGGER_OPTIONS`

2. **Map actual triggers for built-in sequences**
   - `Meeting Requested`: triggered by `autoStartMeetingRequestedSequenceOnSetterEmailReply()`
   - `Re-engagement Follow-up`: triggered by cron + `triggerOn: "no_response"`
   - `Post-Booking`: triggered by `triggerOn: "meeting_selected"`

3. **Identify discrepancies**
   - Which sequences have misleading labels?
   - What should the accurate labels be?

4. **Propose label strategy**
   - Option A: Add new `triggerOn` values for code-triggered sequences
   - Option B: Override display label based on sequence name (simpler, no schema change)
   - Option C: Add `triggerDescription` field to explain trigger behavior

## Output

### Trigger Display Inventory

| Sequence Name | `triggerOn` Value | UI Label Shown | Actual Trigger Behavior |
|--------------|-------------------|----------------|-------------------------|
| Meeting Requested Day 1/2/5/7 | `manual` | "Manual trigger only" | **Code**: `autoStartMeetingRequestedSequenceOnSetterEmailReply()` — starts automatically when setter sends first email reply |
| No Response Day 2/5/7 | `no_response` | "No response (after 24h)" | **Cron**: Backfill requires positive sentiment + prior reply (Phase 66 disabled auto-start) |
| Post-Booking Qualification | `meeting_selected` | "After meeting selected" | **Code**: Triggered after booking completed — accurate label |
| Custom sequences | user-selected | Matches selection | Accurate |

### Discrepancies Found

1. **Meeting Requested**: UI shows "Manual trigger only" but sequence auto-starts on setter email reply
2. **No Response**: UI shows "No response (after 24h)" but Phase 66 disabled auto-start — only backfill applies

### Recommended Approach: **Option B — Override display label based on sequence name**

Rationale:
- No schema changes required
- Simple lookup table in UI component
- Built-in sequence names are constants (`DEFAULT_SEQUENCE_NAMES`)
- Preserves existing behavior, only changes display

Implementation:
```typescript
const BUILT_IN_TRIGGER_OVERRIDES: Record<string, { label: string; tooltip: string }> = {
  "Meeting Requested Day 1/2/5/7": {
    label: "On setter email reply",
    tooltip: "Starts automatically when you send your first email reply to this lead"
  },
  "No Response Day 2/5/7": {
    label: "Backfill only (disabled)",
    tooltip: "Auto-start disabled in Phase 66. Only applies via manual backfill for positive leads."
  },
};
```

### Affected Components

- `components/dashboard/followup-sequence-manager.tsx` (line 429) — sequence card trigger label
- `components/dashboard/followup-sequence-manager.tsx` (lines 561-571) — edit dialog trigger dropdown

## Handoff

→ **Phase 68b**: Implement the `BUILT_IN_TRIGGER_OVERRIDES` lookup and update sequence card display. Consider making trigger field read-only for built-in sequences.
