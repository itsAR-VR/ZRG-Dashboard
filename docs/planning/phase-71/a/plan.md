# Phase 71a — Fix Pause/Resume Bug (UI Data Fetching)

## Focus

Fix the bug where paused follow-up sequences disappear from the UI after page refresh and cannot be properly resumed.

## Inputs

- Root cause analysis from Phase 71 plan
- `components/dashboard/follow-ups-view.tsx` fetches only `"active"` instances

## Work

### Step 1: Update Data Fetching

**File:** `components/dashboard/follow-ups-view.tsx`

Change line 549 from:
```typescript
getWorkspaceFollowUpInstances(activeWorkspace, "active")
```

To:
```typescript
getWorkspaceFollowUpInstances(activeWorkspace, "all")
```

### Step 2: Filter Completed/Cancelled Client-Side (if needed)

The existing `groupInstancesByDay()` function already handles paused instances correctly (lines 741-745). However, we may want to filter out `completed` and `cancelled` instances client-side since they're typically not relevant to the active view.

Check if the grouping function needs adjustment to exclude completed/cancelled or if they should appear in a separate section.

### Step 3: Verify Resume Flow

1. The `handleResumeInstance()` function calls `resumeFollowUpInstance(instanceId)`
2. On success, it calls `fetchData()` to refresh
3. With the fix, paused instances will be fetched and displayed in "Paused" section
4. After resume, they'll move to the appropriate time-based group

## Output

- `components/dashboard/follow-ups-view.tsx` updated to fetch all instances
- Paused sequences visible in UI and resumable

## Handoff

Proceed to Phase 71b to rename the default sequence constant and migrate existing sequences.
