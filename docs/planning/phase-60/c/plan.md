# Phase 60c — Integrate into Settings UI

## Focus
Add the `BookingProcessReference` component to the Settings page, positioning it appropriately relative to the existing BookingProcessManager.

## Inputs
- `BookingProcessReference` component from Phase 60b
- `components/dashboard/settings-view.tsx` (main settings page)
- Existing BookingProcessManager integration

## Work

### 1. Identify Placement in Settings View

The booking-related settings in `settings-view.tsx` include:
- `BookingProcessManager` — CRUD for booking processes
- `BookingProcessAnalytics` — Metrics for booking processes
- Calendar Links card
- Availability settings

**Placement decision:** Add `BookingProcessReference` as a separate card **above** `BookingProcessManager`. This gives users the reference/documentation context before they start creating/editing booking processes.

### 2. Import the Component

In `components/dashboard/settings-view.tsx`:

```typescript
import { BookingProcessReference } from "@/components/dashboard/settings/booking-process-reference";
```

### 3. Add to Settings View

Find the section where BookingProcessManager is rendered and add BookingProcessReference above it:

```tsx
{/* Booking section */}
<div className="space-y-6">
  {/* Reference panel - documentation */}
  <BookingProcessReference />

  {/* Booking process manager - CRUD */}
  <BookingProcessManager
    activeWorkspace={activeWorkspace}
    qualificationQuestions={...}
  />

  {/* Booking process analytics */}
  <BookingProcessAnalytics activeWorkspace={activeWorkspace} />
</div>
```

### 4. Verify Accordion UI Component

Run: `npx shadcn@latest add accordion` if the Accordion component doesn't exist.

### 5. Test the Integration

1. Run `npm run dev`
2. Navigate to Settings
3. Verify:
   - Reference panel appears above BookingProcessManager
   - Accordion items expand/collapse correctly
   - All 5 processes display with correct badges
   - Styling is consistent with rest of Settings UI

## Output
- `BookingProcessReference` integrated into Settings view
- Reference panel visible and functional in the booking section

## Handoff
Pass to Phase 60d for polish, verification, and documentation.
