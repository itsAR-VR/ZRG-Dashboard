# Phase 90c — Server Actions + `getCrmSheetRows` (No Placeholders)

## Focus
Eliminate placeholder columns in the CRM table by computing missing values from existing system tables and exposing mutation endpoints for spreadsheet edits.

## Inputs
- Existing action: `actions/analytics-actions.ts:getCrmSheetRows` (lines 1288-1461)
- Models: `Lead`, `LeadCrmRow`, `Message`, `FollowUpTask`, `Appointment`
- Phase 90a schema changes (jobTitle, leadType, applicationStatus, leadCategoryOverride)

## Work
### 1) Update `getCrmSheetRows` mapping rules
Update the row mapping at lines 1398-1454:
- `date`: `LeadCrmRow.interestRegisteredAt` (was `lead.createdAt`)
- `initialResponseDate`: `LeadCrmRow.interestRegisteredAt`
- `leadCategory`: `leadCategoryOverride ?? interestType ?? Lead.sentimentTag`
- `leadStatus`: `pipelineStatus ?? Lead.status` (hybrid)
- `campaign`: `interestCampaignName` (already correct)
- `jobTitle`: `Lead.jobTitle` (add to Lead select)
- `leadType`: `LeadCrmRow.leadType`
- `applicationStatus`: `LeadCrmRow.applicationStatus`
- **REMOVE** from interface + return: `rollingMeetingRequestRate`, `rollingBookingRate`

### 2) Compute columns from live DB (batched queries)

**a) Step Responded (touch count):**
```sql
SELECT "leadId", COUNT(*) as touch_count
FROM "Message"
WHERE "leadId" IN (...)
  AND direction = 'outbound'
  AND channel = :interestChannel
  AND "sentAt" < :interestRegisteredAt
GROUP BY "leadId"
```
Execute as single batched query for all leadIds on the page.

**b) Follow-up 1..5:**
```sql
SELECT "leadId", "dueDate"
FROM "FollowUpTask"
WHERE "leadId" IN (...)
  AND status = 'pending'
ORDER BY "leadId", "dueDate" ASC
```
Group by leadId in-memory, take first 5 due dates per lead.

**c) Response step complete:**
```sql
SELECT DISTINCT "leadId"
FROM "Message"
WHERE "leadId" IN (...)
  AND direction = 'outbound'
  AND channel = :interestChannel
  AND "sentAt" > :interestRegisteredAt
```
True if leadId appears in result set.

**d) AI vs Human Response (post-interest):**
For each lead, find FIRST outbound message AFTER `interestRegisteredAt`:
```sql
SELECT DISTINCT ON ("leadId") "leadId", "sentBy", "sentByUserId"
FROM "Message"
WHERE "leadId" IN (...)
  AND direction = 'outbound'
  AND channel = :interestChannel
  AND "sentAt" > :interestRegisteredAt
ORDER BY "leadId", "sentAt" ASC
```
Derive: AI if `sentBy === "ai"`, Human if `sentByUserId` or `sentBy === "setter"`, Unknown otherwise.

**Query budget:** 10s timeout; return partial data with warning if exceeded.

### 3) Add server actions for editing

**a) `getCrmAssigneeOptions({ clientId })`:**
- Query `ClientMember` where `clientId` and `role = 'SETTER'`
- Return `{ userId: string, email: string }[]`
- Use `getSupabaseUserEmailsByIds()` to resolve emails

**b) `updateCrmSheetCell({ leadId, field, value, updateAutomation?: boolean })`:**
- **Auth:** Call `requireWorkspaceCapabilities(clientId)` from `lib/workspace-capabilities.ts`
- **RBAC:** Reject if `capabilities.isClientPortalUser === true` (client portal users are read-only per Phase 85)
- **Note:** `WorkspaceCapabilities` currently has `canEditSettings`; Phase 90 may add `canEditCrm` if finer-grained control needed
- **Field routing:**
  | Field | Target | updateAutomation behavior |
  |-------|--------|---------------------------|
  | `jobTitle` | `Lead.jobTitle` | N/A |
  | `leadCategory` | `LeadCrmRow.leadCategoryOverride` | If true, also update `Lead.sentimentTag` via mapping |
  | `leadStatus` | `LeadCrmRow.pipelineStatus` | If true, also update `Lead.status` via mapping |
  | `leadType` | `LeadCrmRow.leadType` | N/A |
  | `applicationStatus` | `LeadCrmRow.applicationStatus` | N/A |
  | `notes` | `LeadCrmRow.notes` | N/A |
  | `campaign` | `LeadCrmRow.interestCampaignName` | N/A |
  | `email` | `Lead.email` | Normalize + dedupe check |
  | `phone` | `Lead.phone` | Normalize + dedupe check |
  | `linkedinUrl` | `Lead.linkedinUrl` | Normalize + dedupe check |
  | `assignedToUserId` | `Lead.assignedToUserId` | N/A |

- **Staleness check:** Accept optional `expectedUpdatedAt`; reject if row was modified since
- **Return:** `{ success: boolean, error?: string, newValue?: any }`

**c) Status/Category heuristic mapping (CONFIRMED):**
| Sheet Value | Lead.status |
|-------------|-------------|
| "Qualified" | "qualified" |
| "Meeting Booked" | "meeting-booked" |
| "Not Interested" | "not-interested" |
| "Blacklisted" | "blacklisted" |
| (other) | "new" |

| Sheet Value | Lead.sentimentTag |
|-------------|-------------------|
| "Meeting Requested" | "Meeting Requested" |
| "Call Requested" | "Call Requested" |
| "Information Requested" | "Information Requested" |
| "Interested" | "Interested" |
| (other) | (unchanged) |

**Edit conflict handling (CONFIRMED):**
- Accept optional `expectedUpdatedAt` timestamp in `updateCrmSheetCell`
- If provided, compare with current `LeadCrmRow.updatedAt` (or `Lead.updatedAt` for Lead fields)
- Reject with error `{ success: false, error: "Row was modified by another user" }` if mismatch

## Validation (RED TEAM)
- [ ] `getCrmSheetRows` returns non-null values for all computed columns
- [ ] Batched queries complete within 10s for 150 rows
- [ ] `updateCrmSheetCell` rejects unauthorized access
- [ ] `updateCrmSheetCell` rejects stale edits (if implemented)
- [ ] Email/phone/linkedin edits normalize and check for duplicates

## Output
- `getCrmSheetRows` now populates CRM rows from live DB:
  - Maps date/category/status/leadType/applicationStatus/jobTitle from CRM + Lead fields
  - Computes step responded, follow-ups, response step complete, response mode
  - Fills follow-up date requested from `Lead.snoozedUntil`
- Server actions added:
  - `getCrmAssigneeOptions` for setter dropdown data
  - `updateCrmSheetCell` for inline cell edits + optional automation sync

## Coordination Notes
**No direct conflicts** in files touched for this subphase.  
**Note:** Added raw SQL queries with 10s timeout guards and warning logs if they fail.

## Validation Notes
- Manual/runtime validation not executed in this environment.

## Handoff
Proceed to Phase 90d to build spreadsheet-like inline editing in the CRM UI using these actions.
