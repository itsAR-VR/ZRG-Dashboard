# Phase 32b — Response Time Calculation with Business Hours Filtering

## Focus

Implement the core response time calculation logic that:
1. Separates setter response times (client→setter) from client response times (setter→client)
2. Filters to only include messages within 9am-5pm EST business hours
3. Returns structured data for both metrics

## Inputs

- Current `calculateAvgResponseTime` function in `actions/analytics-actions.ts`
- Message model with `sentAt`, `direction`, `channel` fields
- Business hours: 9am-5pm EST (America/New_York timezone)

## Work

1. **Create utility function for EST business hours check**
2. **Create new response time calculation function** in `actions/analytics-actions.ts`
3. **Calculation logic** with channel pairing and business hours filtering
4. **Update `AnalyticsData` interface** to include new metrics
5. **Maintain backward compatibility**

## Output

**New file created:**
- `lib/business-hours.ts` with:
  - `isWithinEstBusinessHours(date: Date): boolean` - Checks if date is within 9am-5pm EST, weekdays only
  - `areBothWithinEstBusinessHours(timestamp1: Date, timestamp2: Date): boolean` - Checks both timestamps
  - `formatDurationMs(ms: number): string` - Formats milliseconds to "15m", "2.4h", "1.5d"
  - Uses `Intl.DateTimeFormat` for proper DST handling

**Updated `actions/analytics-actions.ts`:**
- Added `ResponseTimeMetrics` interface:
  ```typescript
  export interface ResponseTimeMetrics {
    setterResponseTime: { avgMs: number; formatted: string; sampleCount: number; };
    clientResponseTime: { avgMs: number; formatted: string; sampleCount: number; };
  }
  ```

- Replaced `calculateAvgResponseTime` with `calculateResponseTimeMetrics`:
  - Limits query to last 30 days for performance
  - Pairs messages only within same channel (avoids cross-channel artifacts)
  - Only counts pairs where BOTH timestamps are within 9am-5pm EST weekdays
  - Caps response times at 7 days (same as before)
  - Separates setter response (inbound→outbound) from client response (outbound→inbound)

- Updated `AnalyticsData.overview` interface:
  ```typescript
  overview: {
    // ... existing fields ...
    avgResponseTime: string;      // Backward compatibility (= setterResponseTime)
    setterResponseTime: string;   // New field
    clientResponseTime: string;   // New field
  }
  ```

- Updated `getAnalytics` to use new metrics function and return all three fields

**Validation:**
- `npm run lint` passes (0 errors)
- `npm run build` succeeds

## Handoff

Subphase c will extend this to aggregate per-setter response times using `sentByUserId`. The `ResponseTimeMetrics` interface and business hours utilities are ready for reuse.
