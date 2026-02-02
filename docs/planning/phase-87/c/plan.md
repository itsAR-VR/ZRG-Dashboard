# Phase 87c — UI Integration (Button + Handler)

## Focus
Add a "Refresh Availability" button in `components/dashboard/action-station.tsx` with loading state and toast feedback.

## Inputs
- Phase 87b output: `refreshDraftAvailability` action from `actions/message-actions.ts`
- Existing UI patterns in `action-station.tsx`:
  - Icon buttons with `h-8 w-8` size in vertical flex layout (lines 1067-1159)
  - Loading states using `Loader2` with `animate-spin`
  - Toast feedback via `toast.success()` / `toast.error()`

## Work

### 1. Add state variable
```typescript
const [isRefreshingAvailability, setIsRefreshingAvailability] = useState(false);
```

### 2. Add handler function
```typescript
const handleRefreshAvailability = async () => {
  if (!drafts.length) return;
  setIsRefreshingAvailability(true);

  // Pass current compose content so user edits are preserved.
  const result = await refreshDraftAvailability(drafts[0].id, composeMessage);

  if (result.success && result.content) {
    toast.success(`Refreshed availability: ${result.newSlots?.length || 0} new slots`);
    setComposeMessage(result.content);
    setOriginalDraft(result.content);
    setDrafts(prev => prev.map(d =>
      d.id === drafts[0].id ? { ...d, content: result.content! } : d
    ));
  } else {
    toast.error(result.error || "Failed to refresh availability");
  }

  setIsRefreshingAvailability(false);
};
```

### 3. Add import
```typescript
import { refreshDraftAvailability } from "@/actions/message-actions";
```

`Clock` is already imported in `components/dashboard/action-station.tsx` today — avoid duplicate imports.

### 4. Add button (after Calendar button, before Reject button at ~line 1081)
```tsx
{/* Refresh Availability button */}
<Button
  variant="outline"
  size="icon"
  onClick={handleRefreshAvailability}
  disabled={isSending || isRegenerating || isRefreshingAvailability}
  className="h-8 w-8"
  aria-label="Refresh availability times"
  title="Refresh availability times"
>
  {isRefreshingAvailability ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : (
    <Clock className="h-4 w-4" />
  )}
</Button>
```

### 5. Icon choice rationale
- `Clock` icon represents "refresh times" - distinct from `RefreshCw` (full regenerate) and `Calendar` (insert link)
- Maintains visual consistency with existing icon button cluster

### 6. Button ordering
Final order: Calendar | **Refresh Availability** | Reject | Regenerate | Approve & Send

## Output
- Modified file: `components/dashboard/action-station.tsx`
- New UI: Clock icon button in the draft action cluster

## Handoff
Phase 87 complete. Verify with:
1. `npm run test`
2. `npm run lint`
3. `npm run build`
4. Manual test: open lead with draft containing availability, click Clock button, verify slots update while prose remains unchanged

## Output (Completed)
- Added `refreshDraftAvailability` import, `isRefreshingAvailability` state, and `handleRefreshAvailability` handler.
- Inserted the Refresh Availability button between Calendar and Reject with loading state + toast feedback.

## Handoff (Ready)
Proceed to Phase 87d: add parser unit tests and run validation (`test`, `lint`, `build`).
