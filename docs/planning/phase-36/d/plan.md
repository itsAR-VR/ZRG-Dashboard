# Phase 36d — Campaign Assignment

## Focus

Add UI and persistence for assigning booking processes to campaigns, enabling A/B testing with same copy but different booking strategies.

## Inputs

- `EmailCampaign.bookingProcessId` field from phase 36a
- `BookingProcess` list from phase 36c
- Existing campaign list UI (wherever campaigns are displayed)
- Existing `actions/email-campaign-actions.ts`

## Work

### 1. Update Campaign Actions

Add to `actions/email-campaign-actions.ts`:

```typescript
export async function assignBookingProcess(
  campaignId: string,
  bookingProcessId: string | null  // null to unassign
): Promise<{ success: boolean; error?: string }>

export async function getCampaignBookingProcess(
  campaignId: string
): Promise<BookingProcess | null>
```

### 2. Identify Campaign List Location

Find where campaigns are displayed in the dashboard. Likely locations:
- `components/dashboard/settings-view.tsx` (campaigns section)
- Dedicated campaigns tab
- Campaign selector in inbox filters

### 3. Add Booking Process Column/Selector

For each campaign row in the list, add:

**Option A: Inline Dropdown**
```
| Campaign Name | Status | Leads | Booking Process      |
|---------------|--------|-------|----------------------|
| SaaS Outreach | Active | 234   | [Direct Link First ▼]|
| Local Biz     | Active | 156   | [Times + Question ▼] |
| Cold Leads    | Paused | 89    | [None              ▼]|
```

**Option B: Settings Icon → Modal**
- Click settings icon on campaign row
- Modal shows campaign settings including booking process dropdown

Recommended: **Option A** for quick access, with "Manage" link to full settings.

### 4. Dropdown Options

The booking process dropdown should include:
- "None (Manual)" — no structured booking process, AI drafts normally
- All saved booking processes by name
- "Create New..." — opens booking process builder (optional shortcut)

### 5. Assignment Persistence

When user selects a booking process:
1. Call `assignBookingProcess(campaignId, bookingProcessId)`
2. Update UI to reflect new assignment
3. Show success toast

### 6. Handle Assignment Changes

**New leads:** Apply newly assigned booking process immediately

**In-progress conversations:** Two options:
- **Option A (Simple):** Continue with old process for existing leads
- **Option B (Flexible):** Offer choice in modal: "Apply to new leads only" vs "Apply to all leads"

Recommended: **Option A** for MVP — new process applies to new leads only. Can add flexibility later.

Track which booking process was active when conversation started:

```prisma
model LeadCampaignReplyCount {
  // ... existing fields ...

  // Track which process was active at conversation start
  activeBookingProcessId String?
  activeBookingProcess   BookingProcess? @relation(fields: [activeBookingProcessId], references: [id])
}
```

Set `activeBookingProcessId` when first reply is sent, use that for duration of conversation.

### 7. Visual Indicators

Show booking process assignment status clearly:
- Badge/chip next to campaign name with process name
- Color coding (optional): different colors for different processes for quick visual scan
- Warning icon if booking process was deleted (orphaned reference)

### 8. Bulk Assignment

For managing many campaigns:
- Multi-select campaigns
- "Assign Booking Process" bulk action
- Dropdown to select process
- Confirmation with count of affected campaigns

### 9. Handle Deleted Booking Processes

When a booking process is deleted:
- Query all campaigns using it
- If any found, prompt user: "This booking process is assigned to X campaigns. Unassign and delete?" or "Reassign these campaigns first"
- If user confirms, set `bookingProcessId = null` on affected campaigns

### 10. API for Campaign List with Booking Process

Update campaign list queries to include booking process:

```typescript
const campaigns = await prisma.emailCampaign.findMany({
  where: { clientId },
  include: {
    bookingProcess: {
      select: { id: true, name: true }
    }
  }
});
```

## Output

- Updated `actions/email-campaign-actions.ts` with assignment functions
- Campaign list UI with booking process dropdown
- Bulk assignment capability
- Handling for deleted booking processes
- `activeBookingProcessId` tracking on `LeadCampaignReplyCount`

## Handoff

Campaigns can be assigned booking processes. Subphase e will use this assignment to inject appropriate instructions into AI drafts based on reply stage.
