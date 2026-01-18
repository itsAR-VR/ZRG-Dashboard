# Phase 34f — Follow-ups UI: Safe Render + “Red” Cancellation Tasks

## Focus
Make the Follow-ups UI robust to new task types introduced by appointment cancellation/reschedule detection (Phase 28), and visually flag them as urgent (“red” indicator).

## Inputs
- Task types introduced by appointment cancellation/reschedule:
  - `lib/appointment-cancellation-task.ts` (creates `FollowUpTask.type = meeting-canceled | meeting-rescheduled`)
- Follow-ups data + UI:
  - `actions/followup-actions.ts` (`getFollowUpTasks` currently types tasks as only `email|call|linkedin|sms`)
  - `components/dashboard/follow-ups-view.tsx` (currently assumes `typeIcons[task.type]` always exists)

## Work
1. Update server action typing to avoid breaking on new task types:
   - Broaden `FollowUpTaskData.type` to include `meeting-canceled` / `meeting-rescheduled` (or use `string` + a discriminated “kind” field).
   - Optionally add `isRedIndicator: boolean` computed server-side to avoid importing server-only helpers into client code.
2. Update UI task typing and rendering:
   - Broaden `UnifiedTask.type` union to include `meeting-canceled` / `meeting-rescheduled`.
   - Add icon/color mappings for these types (default to safe fallback icon if unknown).
   - Add “red” styling for cancellation/reschedule task cards (border/background/badge).
3. Confirm no runtime crashes:
   - Ensure `Icon` is never undefined in `TaskCard`.
4. (Optional) UX polish:
   - Add a small badge label like “Canceled” / “Rescheduled” next to lead name.

## Validation (RED TEAM)
- `npm run lint`
- `npm run build`
- Manual smoke:
  - Create a fake `FollowUpTask` row in DB with `type = meeting-canceled`, open Follow-ups view, verify it renders and is visually “red”.

## Output

### Files Modified

**`actions/followup-actions.ts`**
- Added `FollowUpTaskType` exported type union including `meeting-canceled` and `meeting-rescheduled`
- Updated `FollowUpTaskData` interface to use `FollowUpTaskType` and added `isUrgent?: boolean` field
- Updated task formatting to compute `isUrgent` flag server-side for cancellation/reschedule tasks

**`components/dashboard/follow-ups-view.tsx`**
- Added import for `FollowUpTaskType` from `followup-actions`
- Updated `typeIcons` and `typeColors` with typed Record for new task types:
  - `meeting-canceled`: XCircle icon, red color
  - `meeting-rescheduled`: Calendar icon, orange color
- Added defensive fallbacks (`defaultIcon`, `defaultColor`) for unknown task types
- Updated `UnifiedTask` interface to use `FollowUpTaskType` and include `isUrgent` field
- Updated `TaskCard` component:
  - Safe icon/color lookup with fallback
  - "Red" styling for urgent tasks: `border-red-500/50 bg-red-50 dark:bg-red-950/20`
  - Badge label showing "Canceled" or "Rescheduled" for urgent tasks
- Updated `fetchData` to pass `isUrgent` field to unified tasks

### Validation Results

- `npm run lint` — pass (17 warnings, all pre-existing)
- `npm run build` — pass
- No runtime crashes: Icon is never undefined due to defensive fallback
- Urgent tasks visually distinct with red border/background and badge

## Handoff

Phase 34f is complete. Proceed to Phase 34 wrap-up (`docs/planning/phase-34/review.md`) and track remaining Phase 34 gaps:
- CRM drawer appointment history timeline UI (Phase 34e UI portion)
- Optional: reschedule-chain linking (`rescheduledFromId`) if/when provider signals are available
