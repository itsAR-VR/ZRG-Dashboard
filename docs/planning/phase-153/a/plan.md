# Phase 153a — InboxView Layout Container + Empty-State Centering

## Focus
Restore stable desktop layout by ensuring `InboxView` always renders inside a single full-height flex-row wrapper. This fixes:
- conversation feed + messaging pane stacking vertically after workspace switches, and
- empty/error/loading states not centering vertically.

## Inputs
- Jam `58b1a311-85a0-4246-98af-3f378c148198` repro steps.
- Current implementation: `components/dashboard/inbox-view.tsx` returns a fragment with:
  - `ConversationFeed` (desktop uses `w-80`)
  - `ActionStation` (uses `flex-1`)
  - plus early-return branches (spinner, error, empty) that assume a flex parent.
- Coordination constraints from Phase 149/152 (avoid render churn regressions).

## Work
1. Pre-flight conflict check:
   - `git status --porcelain`
   - re-read `components/dashboard/inbox-view.tsx` to confirm current structure.
2. Add a single top-level wrapper for all InboxView render paths:
   - `div` with: `relative flex h-full min-h-0 w-full overflow-hidden`
   - Keep status badges positioned relative to this wrapper (existing absolute positioning should remain valid).
3. Convert early returns (delayed spinner, error state, empty states) into renders inside the wrapper, using:
   - `div className="flex flex-1 items-center justify-center"` for vertical centering.
4. Ensure the “normal” path renders:
   - `ConversationFeed` (left)
   - `ActionStation` (right)
   as direct children of the wrapper so desktop stays side-by-side.
5. Confirm mobile behavior is unaffected:
   - `ConversationFeed` uses `Sheet` on mobile; keep that intact.

## Output
- Implemented in `components/dashboard/inbox-view.tsx`:
  - Added shared `relative flex h-full min-h-0 w-full overflow-hidden` wrapper for normal render path.
  - Updated delayed-spinner, error, and empty-state branches to render inside the same full-height wrapper.
  - Preserved existing `ConversationFeed` + `ActionStation` composition while making side-by-side layout deterministic on desktop.
- Empty/error/loading states now have a reliable vertical-centering context.

## Handoff
Proceed to Phase 153b (now implemented) for message-load concurrency hardening.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Re-read current `InboxView` render branches and confirmed early returns lacked the full-height flex container.
  - Applied a surgical layout patch without altering filtering/query logic.
  - Preserved mobile behavior by leaving `ConversationFeed` mobile sheet logic unchanged.
- Commands run:
  - `git status --porcelain` — pass; no unexpected concurrent edits.
  - `sed -n '920,1260p' components/dashboard/inbox-view.tsx` — verified return-path structure before edit.
- Blockers:
  - None for this subphase.
- Next concrete steps:
  - Complete and validate subphases 153b, 153c, and 153d.
