# Phase 32c — Per-Setter Aggregation Logic

## Focus

Extend the response time calculation to provide per-setter breakdowns, aggregating response times by the `sentByUserId` field and joining with `ClientMember` data for display names.

## Inputs

- Response time calculation logic from 32b
- `Message.sentByUserId` field from 32a
- `ClientMember` model with `userId`, `role`, `clientId`
- `getSupabaseUserEmailById` helper from `lib/supabase/admin.ts`

## Work

1. **Create per-setter response time interface**
2. **Add aggregation function**
3. **Implementation approach**
4. **Handle edge cases**
5. **Update analytics return type**

## Output

**New interface added to `actions/analytics-actions.ts`:**
```typescript
export interface SetterResponseTimeRow {
  userId: string;
  email: string | null;
  role: ClientMemberRole | null; // null if former member
  avgResponseTimeMs: number;
  avgResponseTimeFormatted: string;
  responseCount: number;
}
```

**New function `calculatePerSetterResponseTimes(clientId: string)`:**
- Queries messages from last 30 days for performance
- Groups response times by `sentByUserId`
- Only counts setter responses (inbound → outbound with sentByUserId not null)
- Pairs messages within same channel only
- Applies same business hours filter (9am-5pm EST, weekdays)
- Caps response times at 7 days
- Fetches emails via `getSupabaseUserEmailById` (batched with Promise.all)
- Joins with `ClientMember` to get role (null for former members)
- Returns sorted by response count (most active first)

**Updated `AnalyticsData` interface:**
```typescript
interface AnalyticsData {
  // ... existing fields ...
  perSetterResponseTimes: SetterResponseTimeRow[];
}
```

**Updated `getAnalytics` function:**
- Empty data now includes `perSetterResponseTimes: []`
- Only calculates per-setter data when `clientId` is specified (specific workspace selected)
- Returns empty array for "All Workspaces" view

**Edge cases handled:**
- No setter accounts: Returns empty array
- Former members (no ClientMember record): role is null, email still fetched
- AI/system sent messages: Excluded (sentByUserId is null)
- Workspaces with no recent messages: Returns empty array

**Validation:**
- `npm run lint` passes (0 errors)
- `npm run build` succeeds

## Handoff

Subphase d will consume `perSetterResponseTimes` to render a per-setter breakdown table in the analytics UI. The data structure is ready with email, role, avg response time, and response count for each setter.
