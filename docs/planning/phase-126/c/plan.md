# Phase 126c — Analytics + UI + Insights Snapshot Integration

## Focus
Expose capacity utilization in a way that:
- appears in the Analytics UI for operators
- becomes part of the Insights Chat analytics snapshot so AI answers can reference it (workspace-scope only)

## Inputs
- `lib/calendar-capacity-metrics.ts:getWorkspaceCapacityUtilization()` from 126b
- Analytics entry point: `actions/analytics-actions.ts:getAnalytics()` — returns `AnalyticsData` with `overview` object (currently 7 KPI fields)
- Analytics UI: `components/dashboard/analytics-view.tsx` — 7 KPI cards in `kpiCards` array, rendered in `lg:grid-cols-7` grid
- Insights Chat: `actions/insights-chat-actions.ts:buildAnalyticsSnapshot()` → stored in `InsightContextPack.metricsSnapshot`

## RED TEAM Context

**CRITICAL-1 (resolved):** `buildAnalyticsSnapshot()` has two mutually exclusive paths:
```
if (campaignIds.length > 0) → getEmailCampaignAnalytics() ONLY
else → getAnalytics()
```
Capacity metric will only appear in workspace-scoped Insights Chat. Campaign-scoped chats will not include it. This is an accepted limitation.

## Work

### 1. Extend analytics data shape

Update `actions/analytics-actions.ts`:

- Add to `AnalyticsData.overview` interface:
  ```typescript
  capacity?: CapacityUtilization;  // From 126b, undefined when no calendar configured
  ```
- **Server Action serialization safety (RED TEAM H-4):** The `CapacityUtilization` type from 126b already uses ISO strings, not `Date` objects. No conversion needed at this layer — but verify during implementation.

### 2. Populate in `getAnalytics(clientId, ...)`

- Only compute when `clientId` is provided (workspace scope, not cross-workspace).
- Call `getWorkspaceCapacityUtilization({ clientId, windowDays: 30 })`.
- Capacity uses a **forward-looking window** (next 30d from now), independent of the analytics date range filter used for other metrics. Store under `overview.capacity` with explicit `windowDays`/`fromUtcIso`/`toUtcIso` so consumers know the window.
- If the function returns `totalSlots === 0` (no calendar configured), still include the object so the UI can show a meaningful empty state.

### 3. UI (`components/dashboard/analytics-view.tsx`)

**KPI Card (RED TEAM H-3 resolution):**

- Label: **"Capacity (30d)"** (short — fits grid without truncation)
- Icon: `CalendarClock` or `Gauge` from lucide-react
- Value: formatted percent (e.g. "73%") or "—" if `bookedPct` is null
- Tooltip (rich, multi-line):
  - Combined: "Booked: N / Available: N / Total: N"
  - Breakdown: "Default: N% | Direct Book: N%"
  - If `unattributedBookedSlots > 0`: "Unattributed: N — may be historical (pending backfill) or from unconfigured calendars" **(RED TEAM M-3)**
  - If any `cacheMeta[].isStale`: "⚠ Availability data is stale (last updated {relative time})" **(RED TEAM H-2)**

**Grid layout adjustment:**

Current: `lg:grid-cols-7` with 7 cards.

Update to: `lg:grid-cols-4` with 2 rows of 4 cards — symmetric, gives each card ~25% width at `lg` breakpoint. This accommodates the 8th card cleanly and provides room for future additions.

```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
```

Remove the `lg:grid-cols-7` class. The `md:grid-cols-4` breakpoint handles tablets and up.

**Add the 8th card to `kpiCards` array:**
```typescript
{
  label: "Capacity (30d)",
  value: data?.overview.capacity?.bookedPct != null
    ? `${Math.round(data.overview.capacity.bookedPct * 100)}%`
    : "—",
  icon: CalendarClock,
  tooltip: buildCapacityTooltip(data?.overview.capacity),
}
```

### 4. Insights Chat (workspace-scope only — RED TEAM C-1 resolution)

**No changes to `buildAnalyticsSnapshot()`'s campaign path (Path A).**

The workspace path (Path B, `campaignIds.length === 0`) already calls `getAnalytics(opts.clientId)`, which will now include `overview.capacity`. The capacity metric flows through automatically:

```
getAnalytics() → includes overview.capacity
  → buildAnalyticsSnapshot() (workspace path) → { type: "workspace", data: analyticsData }
    → stored in InsightContextPack.metricsSnapshot
      → JSON-stringified into answerInsightsChatQuestion() input payload
```

**Validation during implementation:**
1. Confirm the workspace path returns `data.overview.capacity` in the snapshot
2. Test: open workspace-scoped Insights Chat → ask "what is my calendar capacity?" → verify AI references the metric with real numbers
3. Test: open campaign-scoped Insights Chat → ask about capacity → verify AI does NOT hallucinate numbers (it should say it doesn't have that data or respond with workspace-level context)

**Optional enhancement (not required for v1):** Add a comment in the campaign path (Path A) of `buildAnalyticsSnapshot` noting that capacity metrics are workspace-scope only:
```typescript
if (opts.campaignIds.length > 0) {
  // Note: capacity utilization is workspace-scope only (Phase 126).
  // Campaign-scoped chats use getEmailCampaignAnalytics() which does not include it.
  ...
}
```

### Validation Steps
1. Load analytics view for a workspace with calendar configured → verify "Capacity (30d)" KPI card appears with correct value
2. Hover tooltip → verify breakdown, unattributed count, and cache freshness are shown
3. Load analytics for workspace with NO calendar → verify "—" value, tooltip explains no availability configured
4. Verify grid renders cleanly at 1280px, 1440px, 1920px viewports (2 rows of 4)
5. Open workspace-scoped Insights Chat → ask about capacity → verify AI uses real numbers
6. Open campaign-scoped Insights Chat → ask about capacity → verify AI does not hallucinate

## Output
- Capacity metric is visible in the Analytics UI and included in workspace-scoped Insights Chat snapshots.
- Campaign-scoped Insights Chat does not include capacity (documented limitation).

## Handoff
Proceed to Phase 126d to add tests, run quality gates, and document QA/rollout and coordination notes.
