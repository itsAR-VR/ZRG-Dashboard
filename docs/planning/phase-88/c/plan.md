# Phase 88c — Analytics UI Updates + Consolidate Booking Analytics

## Focus
Update the Analytics tab to include workflow + reactivation analytics, add a working date selector, and move any booking-related analytics currently shown outside Analytics into the Analytics tab.

## Inputs
- Phase 88b backend action outputs and types.
- Current Analytics UI (`components/dashboard/analytics-view.tsx`) and Phase 83 CRM table additions.
- Current booking analytics UI component:
  - `components/dashboard/settings/booking-process-analytics.tsx` (currently rendered inside Settings/Booking).
- Current booking analytics actions:
  - `actions/booking-process-analytics-actions.ts` (exports `getBookingProcessMetrics`, `getBookingProcessSummary`).

## Pre-Flight Conflict Check

Before editing any file:
1. [ ] Re-read `components/dashboard/analytics-view.tsx` to get latest state (Phase 83 may have modified)
2. [ ] Re-read `components/dashboard/settings-view.tsx` to understand current booking analytics placement
3. [ ] Run `git status` to check for uncommitted changes from other phases

## Work

### Step 1: Enable and enhance the date selector
**File:** `components/dashboard/analytics-view.tsx`

Current state (line 197-208):
```tsx
<Select defaultValue="7d">
  <SelectTrigger className="w-[150px]" disabled title="Time range filtering is coming soon">
```

Changes:
1. Remove `disabled` attribute
2. Add state: `const [dateRange, setDateRange] = useState<'24h' | '7d' | '30d' | '90d'>('30d')`
3. Compute `{ from, to }` dates based on selected range
4. Pass window to analytics fetch calls

### Step 2: Add Workflow Attribution section
**File:** `components/dashboard/analytics-view.tsx`

Add new card in Overview tab after the existing KPI cards:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Booking Attribution</CardTitle>
    <CardDescription>How bookings were generated (initial response vs follow-up workflow)</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Summary stats: Total booked, % from initial, % from workflow */}
    <div className="grid grid-cols-3 gap-4 mb-4">
      <div><span className="text-2xl font-bold">{totalBooked}</span><p className="text-xs text-muted-foreground">Total Booked</p></div>
      <div><span className="text-2xl font-bold">{initialRate}%</span><p className="text-xs text-muted-foreground">From Initial</p></div>
      <div><span className="text-2xl font-bold">{workflowRate}%</span><p className="text-xs text-muted-foreground">From Workflow</p></div>
    </div>

    {/* Per-sequence breakdown table */}
    {bySequence.length > 0 && (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sequence</TableHead>
            <TableHead className="text-right">Bookings</TableHead>
            <TableHead className="text-right">% of Workflow</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bySequence.map(row => (
            <TableRow key={row.sequenceId}>
              <TableCell>{row.sequenceName}</TableCell>
              <TableCell className="text-right">{row.bookedCount}</TableCell>
              <TableCell className="text-right">{row.percentage.toFixed(1)}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )}
  </CardContent>
</Card>
```

Data fetching:
- Call `getWorkflowAttributionAnalytics({ clientId: activeWorkspace, from, to })`
- Add state: `const [workflowAttribution, setWorkflowAttribution] = useState<WorkflowAttributionData | null>(null)`

### Step 3: Add Reactivation KPIs section
**File:** `components/dashboard/analytics-view.tsx`

Add new card or table in Overview tab:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Reactivation Campaigns</CardTitle>
    <CardDescription>Performance of lead reactivation campaigns</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Table with: Campaign | Sent | Responded | Response Rate | Booked | Booking Rate */}
    {/* Totals row at bottom */}
  </CardContent>
</Card>
```

Data fetching:
- Call `getReactivationCampaignAnalytics({ clientId: activeWorkspace, from, to })`
- Add state for reactivation data
- Handle empty state (no reactivation campaigns exist)

### Step 4: Add Booking tab and move BookingProcessAnalytics
**File:** `components/dashboard/analytics-view.tsx`

1. Add new tab to TabsList:
```tsx
<TabsTrigger value="booking">Booking</TabsTrigger>
```

2. Add TabsContent:
```tsx
<TabsContent value="booking" className="flex-1">
  <div className="p-6">
    <BookingProcessAnalytics activeWorkspace={activeWorkspace} />
  </div>
</TabsContent>
```

3. Update imports:
```tsx
import { BookingProcessAnalytics } from "@/components/dashboard/settings/booking-process-analytics"
```

### Step 5: Remove BookingProcessAnalytics from Settings
**File:** `components/dashboard/settings-view.tsx`

1. Locate where `BookingProcessAnalytics` is rendered (likely in a Booking tab section)
2. Remove the component and its import
3. Keep the booking process management UI (editor, not analytics)
4. Optionally add a link: "View booking analytics in Analytics tab"

### Step 6: Ensure UX consistency

**Empty states:**
- No workspace selected → "Select a workspace to view analytics"
- No data in window → "No [workflow/reactivation/booking] data for the selected period"
- No reactivation campaigns configured → "No reactivation campaigns configured. Set up reactivation in Settings."

**Loading states:**
- Use existing `<Loader2>` spinner pattern
- Individual section loading (don't block entire tab)

**Error handling:**
- Toast errors using existing `toast.error()` pattern from sonner
- Graceful degradation: show other sections even if one fails

## Validation (RED TEAM)

- [ ] Date selector changes window and all sections re-fetch
- [ ] Switching workspaces resets data and re-fetches
- [ ] Empty states render correctly for each scenario
- [ ] BookingProcessAnalytics works correctly after move (no broken imports)
- [ ] Settings tab still has booking process editor (not analytics)
- [ ] No console errors in browser dev tools

## Output
- Analytics tab updated with tabs: Overview | Workflows | Campaigns | Booking | CRM
- Working date selector (7/30/90 + custom range) wired to all analytics fetches
- Workflows tab: attribution KPI cards + per-sequence breakdown table
- Campaigns tab: Reactivation KPIs + Email campaign KPIs (moved out of Overview)
- Booking tab: `BookingProcessAnalytics` moved from Settings
- Settings no longer shows booking analytics panel

## Coordination Notes

**Overlaps:** `components/dashboard/analytics-view.tsx` and `components/dashboard/settings-view.tsx` are also modified by Phase 83/90/80/81.  
**Resolution:** Re-read current file state and merged changes without touching CRM table logic or Settings configuration sections.

## Handoff
Subphase 88d validates end-to-end behavior (lint/build) and provides rollout + verification notes.
