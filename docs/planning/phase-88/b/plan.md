# Phase 88b — Backend Actions + Date Window Support

## Focus
Implement server-side analytics actions for workflow attribution and reactivation KPIs, and add consistent date-window support (including safe caching) to existing analytics calls used by the Analytics tab.

## Inputs
- Phase 88a metric definitions + contracts.
- Existing patterns in `actions/analytics-actions.ts`:
  - `requireAuthUser()`, `accessibleClientWhere`, `accessibleLeadWhere`
  - in-memory analytics cache and cache key semantics (line 17-32)
  - existing window parameters in `getEmailCampaignAnalytics({ from, to })` (line 875)
- Existing data production:
  - Follow-up execution creates `FollowUpTask` + outbound `Message` (`lib/followup-engine.ts`)
  - Reactivation sends create outbound `Message` + `ReactivationSendLog` (`lib/reactivation-engine.ts`)

## Work

### Step 1: Add `getWorkflowAttributionAnalytics` server action
**File:** `actions/analytics-actions.ts`

```typescript
export async function getWorkflowAttributionAnalytics(opts?: {
  clientId?: string | null;
  from?: string;
  to?: string;
}): Promise<{
  success: boolean;
  data?: WorkflowAttributionData;
  error?: string;
}> {
  // 1. requireAuthUser()
  // 2. Validate clientId access if provided
  // 3. Build window defaults (last 30 days if not specified)
  // 4. Query with raw SQL for efficiency:
  //    - CTE for booked leads in window
  //    - LEFT JOIN FollowUpInstance to find lastStepAt
  //    - Aggregate into initial/workflow/unattributed buckets
  // 5. Return typed payload
}
```

**Query approach (with per-sequence breakdown):**
```sql
-- Query 1: Get totals
WITH booked_leads AS (
  SELECT l.id, l."appointmentBookedAt"
  FROM "Lead" l
  WHERE l."clientId" = $clientId
    AND l."appointmentBookedAt" >= $from
    AND l."appointmentBookedAt" < $to
),
workflow_attribution AS (
  SELECT
    bl.id,
    bl."appointmentBookedAt",
    MIN(fi."lastStepAt") AS earliest_step_at
  FROM booked_leads bl
  LEFT JOIN "FollowUpInstance" fi ON fi."leadId" = bl.id
    AND fi."lastStepAt" IS NOT NULL
    AND fi."lastStepAt" < bl."appointmentBookedAt"
  GROUP BY bl.id, bl."appointmentBookedAt"
)
SELECT
  COUNT(*) AS total_booked,
  COUNT(*) FILTER (WHERE earliest_step_at IS NULL) AS booked_initial,
  COUNT(*) FILTER (WHERE earliest_step_at IS NOT NULL) AS booked_workflow
FROM workflow_attribution;

-- Query 2: Per-sequence breakdown (for workflow-attributed bookings)
WITH booked_leads AS (
  SELECT l.id, l."appointmentBookedAt"
  FROM "Lead" l
  WHERE l."clientId" = $clientId
    AND l."appointmentBookedAt" >= $from
    AND l."appointmentBookedAt" < $to
),
attributed_sequence AS (
  SELECT DISTINCT ON (bl.id)
    bl.id AS lead_id,
    fi."sequenceId",
    fs.name AS sequence_name
  FROM booked_leads bl
  INNER JOIN "FollowUpInstance" fi ON fi."leadId" = bl.id
    AND fi."lastStepAt" IS NOT NULL
    AND fi."lastStepAt" < bl."appointmentBookedAt"
  INNER JOIN "FollowUpSequence" fs ON fs.id = fi."sequenceId"
  ORDER BY bl.id, fi."lastStepAt" ASC -- earliest step wins
)
SELECT
  "sequenceId",
  sequence_name,
  COUNT(*) AS booked_count
FROM attributed_sequence
GROUP BY "sequenceId", sequence_name
ORDER BY booked_count DESC;
```

### Step 2: Add `getReactivationCampaignAnalytics` server action
**File:** `actions/analytics-actions.ts`

**Query approach:**
```sql
WITH sent_enrollments AS (
  SELECT
    re.id,
    re."campaignId",
    re."leadId",
    re."sentAt",
    rc.name AS campaign_name
  FROM "ReactivationEnrollment" re
  INNER JOIN "ReactivationCampaign" rc ON rc.id = re."campaignId"
  WHERE rc."clientId" = $clientId
    AND re.status = 'sent'
    AND re."sentAt" >= $from
    AND re."sentAt" < $to
),
responded AS (
  SELECT DISTINCT se.id
  FROM sent_enrollments se
  INNER JOIN "Message" m ON m."leadId" = se."leadId"
    AND m.direction = 'inbound'
    AND m."sentAt" > se."sentAt"
),
booked AS (
  SELECT DISTINCT se.id
  FROM sent_enrollments se
  INNER JOIN "Lead" l ON l.id = se."leadId"
    AND l."appointmentBookedAt" > se."sentAt"
)
SELECT
  se."campaignId",
  se.campaign_name,
  COUNT(*) AS total_sent,
  COUNT(*) FILTER (WHERE r.id IS NOT NULL) AS responded,
  COUNT(*) FILTER (WHERE b.id IS NOT NULL) AS meetings_booked
FROM sent_enrollments se
LEFT JOIN responded r ON r.id = se.id
LEFT JOIN booked b ON b.id = se.id
GROUP BY se."campaignId", se.campaign_name;
```

### Step 3: Update cache key semantics for windowed queries
**File:** `actions/analytics-actions.ts`

- **Option A:** Incorporate window hash into cache key: `${userId}:${clientId}:${from}:${to}`
- **Option B:** Use separate cache maps for windowed vs non-windowed queries

**Decision:** Option A (simpler, consistent with existing pattern)

**Implementation:**
```typescript
function buildCacheKey(userId: string, clientId: string | null, from?: string, to?: string): string {
  const base = `${userId}:${clientId || '__all__'}`;
  if (from || to) {
    return `${base}:${from || 'start'}:${to || 'now'}`;
  }
  return base;
}
```

### Step 4: Add telemetry featureIds
- `analytics.workflow_attribution` — for workflow attribution queries
- `analytics.reactivation_kpis` — for reactivation analytics queries

### Step 5: Security checklist
- [ ] Use `accessibleClientWhere(user.id)` for client validation
- [ ] Use `accessibleLeadWhere(user.id)` for lead queries if doing all-workspaces scope
- [ ] Include `user.id` in cache keys (already done)
- [ ] No PII in error messages

## Validation (RED TEAM)

- [ ] Run `npm run lint` after adding new exports
- [ ] Run `npm run build` to verify TypeScript compilation
- [ ] Test with large window (90 days) to verify query doesn't timeout
- [ ] Test with empty results (no follow-up instances, no reactivation campaigns)
- [ ] Verify cache isolation by switching users/workspaces

## Output
- New server actions in `actions/analytics-actions.ts`:
  - `getWorkflowAttributionAnalytics()`
  - `getReactivationCampaignAnalytics()`
- Added `AnalyticsWindow` + `resolveAnalyticsWindow()` helper and window-aware cache keys in `getAnalytics()`
- Windowed analytics behavior updated:
  - KPI counts, sentiment breakdown, weekly stats, top clients, SMS sub-clients
  - Response-time metrics now accept optional window
- No schema/index changes (noted performance watchlist in Phase 88a)

## Coordination Notes

**Overlaps:** `actions/analytics-actions.ts` is also modified by Phase 83/90 (CRM analytics).  
**Resolution:** Re-read current file state and appended new actions + window support without altering CRM table logic.

## Handoff
Subphase 88c wires the new backend analytics into the Analytics UI and relocates booking analytics into the Analytics tab. The UI should:
1. Import the new action functions
2. Add state management for workflow/reactivation data
3. Integrate with existing date selector (currently disabled in analytics-view.tsx line 198)
