# Phase 32d — Analytics UI Updates

## Focus

Update the analytics dashboard UI to display the new response time metrics:
1. Separate KPI cards for setter and client response times
2. Per-setter breakdown table

## Inputs

- Updated `AnalyticsData` interface from 32b/32c with:
  - `setterResponseTime`
  - `clientResponseTime`
  - `perSetterResponseTimes`
- Current `analytics-view.tsx` component with KPI cards grid

## Work

1. **Update KPI cards section**
2. **Add per-setter breakdown table**
3. **Conditional rendering**
4. **Visual enhancements**
5. **Update KPI card icons**

## Output

**Updated `components/dashboard/analytics-view.tsx`:**

**New imports:**
- Added `Send`, `Inbox`, `Info` icons from lucide-react
- Added `SetterResponseTimeRow` type import

**KPI Cards changes:**
- Changed grid from `lg:grid-cols-6` to `lg:grid-cols-7` to accommodate 7 cards
- Replaced single "Avg Response Time" card with two separate cards:
  - "Setter Response" - using `Send` icon, shows `setterResponseTime`
  - "Client Response" - using `Inbox` icon, shows `clientResponseTime`
- Added tooltip (via title attribute on info icon) explaining the business hours filtering

**New Per-Setter Response Times table:**
- Shows only when `activeWorkspace` is selected
- Displays setter email, role (from ClientMember), avg response time, and response count
- Rankings: Gold (1st), silver (2nd), bronze (3rd) with colored badges
- Color-coded response time badges:
  - Green (default): < 30 minutes
  - Yellow (secondary): 30m - 2h
  - Red (destructive): > 2h
- Empty state message explaining when data will appear

**Positioning:**
- Per-setter table placed before SMS Sub-clients section for better visual hierarchy

**Validation:**
- `npm run lint` passes (0 errors)
- `npm run build` succeeds

## Handoff

Phase 32d complete. UI now displays:
- Separated setter/client response time KPIs with tooltips
- Per-setter breakdown table with color-coded performance indicators

Ready for Phase 32e hardening and QA.
