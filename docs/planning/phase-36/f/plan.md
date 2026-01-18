# Phase 36f — Analytics & Tracking

## Focus

Build analytics to measure and compare booking process effectiveness, enabling data-driven A/B testing across campaigns.

## Inputs

- `LeadCampaignReplyCount` with `activeBookingProcessId` from phase 36d
- `Lead.sentiment` for "meeting booked" detection
- Existing analytics infrastructure in `components/dashboard/analytics-view.tsx`
- Existing analytics actions in `actions/analytics-actions.ts`

## Work

### 1. Define Booking Process Metrics

**Core Metrics:**

| Metric | Definition | Calculation |
|--------|------------|-------------|
| Leads Processed | Leads who received at least 1 AI reply using this process | Count distinct leads with activeBookingProcessId |
| Booked | Leads who reached "meeting booked" sentiment | Count leads with sentiment = 'meeting_booked' |
| Booking Rate | % of processed leads who booked | Booked / Leads Processed |
| Avg Replies to Book | Average outbound messages before booking | Sum(total replies for booked leads) / Booked |
| Drop-off by Stage | Where leads stop responding | Count leads whose last reply was at stage N |

**Show Rate (future):**
- Currently proxied by "meeting booked" sentiment
- Note: True show rate requires post-meeting confirmation (Calendly webhook or manual entry)

### 2. Create Analytics Data Model

Option A: Computed on-demand from existing tables

Option B: Materialized aggregates for performance

**Recommended: Start with Option A, add caching if slow**

```typescript
// actions/booking-process-analytics-actions.ts

interface BookingProcessMetrics {
  bookingProcessId: string;
  bookingProcessName: string;
  leadsProcessed: number;
  leadsBooked: number;
  bookingRate: number;  // 0-1
  avgRepliesToBook: number;
  dropoffByStage: Record<number, number>;  // { 1: 50, 2: 30, 3: 10 }
}

export async function getBookingProcessMetrics(params: {
  clientId: string;
  bookingProcessId?: string;  // Filter to specific process
  campaignId?: string;        // Filter to specific campaign
  dateRange?: { start: Date; end: Date };
}): Promise<BookingProcessMetrics[]>
```

### 3. Implement Metrics Calculation

```typescript
export async function getBookingProcessMetrics(params: {
  clientId: string;
  bookingProcessId?: string;
  campaignId?: string;
  dateRange?: { start: Date; end: Date };
}): Promise<BookingProcessMetrics[]> {

  // Get all reply count records with booking process
  const replyRecords = await prisma.leadCampaignReplyCount.findMany({
    where: {
      campaign: { clientId: params.clientId },
      activeBookingProcessId: params.bookingProcessId ?? { not: null },
      ...(params.campaignId && { campaignId: params.campaignId }),
      ...(params.dateRange && {
        createdAt: {
          gte: params.dateRange.start,
          lte: params.dateRange.end,
        }
      }),
    },
    include: {
      lead: { select: { id: true, sentiment: true } },
      activeBookingProcess: { select: { id: true, name: true } },
    }
  });

  // Group by booking process
  const byProcess = groupBy(replyRecords, r => r.activeBookingProcessId);

  return Object.entries(byProcess).map(([processId, records]) => {
    const processName = records[0]?.activeBookingProcess?.name ?? 'Unknown';
    const leadsProcessed = records.length;
    const bookedRecords = records.filter(
      r => r.lead.sentiment === 'meeting_booked'
    );
    const leadsBooked = bookedRecords.length;

    // Calculate avg replies to book
    const totalReplies = bookedRecords.reduce((sum, r) => {
      return sum + r.emailReplyCount + r.smsReplyCount + r.linkedinReplyCount;
    }, 0);
    const avgRepliesToBook = leadsBooked > 0 ? totalReplies / leadsBooked : 0;

    // Calculate drop-off by stage
    // Stage = max reply count across channels for non-booked leads
    const dropoffByStage: Record<number, number> = {};
    const nonBooked = records.filter(
      r => r.lead.sentiment !== 'meeting_booked'
    );
    for (const record of nonBooked) {
      const maxReplies = Math.max(
        record.emailReplyCount,
        record.smsReplyCount,
        record.linkedinReplyCount
      );
      const stage = maxReplies || 1;
      dropoffByStage[stage] = (dropoffByStage[stage] ?? 0) + 1;
    }

    return {
      bookingProcessId: processId,
      bookingProcessName: processName,
      leadsProcessed,
      leadsBooked,
      bookingRate: leadsProcessed > 0 ? leadsBooked / leadsProcessed : 0,
      avgRepliesToBook,
      dropoffByStage,
    };
  });
}
```

### 4. Add Comparison Query

For A/B testing same campaign copy with different processes:

```typescript
export async function compareBookingProcesses(params: {
  clientId: string;
  processIds: string[];  // Compare these specific processes
  dateRange?: { start: Date; end: Date };
}): Promise<{
  processes: BookingProcessMetrics[];
  comparison: {
    bestBookingRate: string;  // Process ID
    bestAvgReplies: string;   // Process ID (lowest is best)
  };
}>
```

### 5. Build Analytics UI Components

**Create `components/dashboard/booking-process-analytics.tsx`:**

**Overview Cards:**
```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Direct Link     │ │ Times + Q First │ │ Relationship    │
│                 │ │                 │ │                 │
│ 234 processed   │ │ 189 processed   │ │ 156 processed   │
│ 52% booking rate│ │ 65% booking rate│ │ 48% booking rate│
│ 1.2 avg replies │ │ 2.1 avg replies │ │ 3.4 avg replies │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

**Comparison Table:**
```
| Booking Process    | Leads | Booked | Rate  | Avg Replies |
|--------------------|-------|--------|-------|-------------|
| Times + Q First    | 189   | 123    | 65%   | 2.1         |
| Direct Link        | 234   | 122    | 52%   | 1.2         |
| Relationship       | 156   | 75     | 48%   | 3.4         |
```

**Drop-off Funnel (per process):**
```
Stage 1: ████████████████████ 100%
Stage 2: ████████████████     80%
Stage 3: ████████████         60%
Booked:  ██████████           52%
```

### 6. Add Filters

- **Date range:** Last 7 days, 30 days, 90 days, custom
- **Campaign:** Filter to specific campaign(s)
- **Booking process:** Filter to specific process(es)
- **Channel:** Filter by email/SMS/LinkedIn performance

### 7. Integrate into Analytics View

Add "Booking Processes" section to existing `components/dashboard/analytics-view.tsx`:

```typescript
// In analytics-view.tsx
<Tabs>
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
    <TabsTrigger value="booking-processes">Booking Processes</TabsTrigger>  {/* NEW */}
  </TabsList>

  {/* ... existing tabs ... */}

  <TabsContent value="booking-processes">
    <BookingProcessAnalytics clientId={clientId} />
  </TabsContent>
</Tabs>
```

### 8. Per-Campaign Breakdown

When viewing a specific campaign, show booking process performance:

```
Campaign: SaaS Outreach v1

Booking Process: Direct Link First
├─ Leads: 234
├─ Booked: 122 (52%)
├─ Avg replies: 1.2
└─ Drop-off: Stage 1 (48 leads), Stage 2 (28 leads)
```

### 9. Export Capability

Add export button to download CSV:

```csv
booking_process,campaign,leads_processed,leads_booked,booking_rate,avg_replies
"Direct Link First","SaaS v1",234,122,0.52,1.2
"Times + Q First","SaaS v2",189,123,0.65,2.1
```

### 10. Attribution Tracking

Ensure booking process attribution is set correctly:

- When first AI reply is sent to a lead for a campaign, set `activeBookingProcessId`
- This captures which process was active at conversation start
- Allows accurate historical analysis even if process is changed later

### 11. Real-time vs Aggregated

**MVP: Real-time queries**
- Acceptable for workspaces with <10k leads
- May need optimization for larger datasets

**Future: Aggregated rollups**
- Daily aggregation job
- Materialized `BookingProcessDailyMetrics` table
- Faster queries for historical analysis

## Output

- `actions/booking-process-analytics-actions.ts` with metrics queries
- `components/dashboard/booking-process-analytics.tsx` with visualizations
- Updated `analytics-view.tsx` with new tab
- Comparison and filter capabilities
- CSV export

## Handoff

Phase 36 complete. Users can:
1. Create booking processes with configurable stages
2. Assign them to campaigns
3. AI respects stage rules when drafting
4. Compare effectiveness via analytics

Future enhancements:
- True show rate tracking (post-meeting webhooks)
- ML-suggested optimal process per industry
- Auto-optimization (gradually shift traffic to best performer)
