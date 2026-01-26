# Phase 58c — UI Update: Add Public Booking Link Field to Calendar Link Settings

## Focus
Update the Calendar Link settings UI to allow editing the `publicUrl` field separately from the `url` field, with clear labeling to explain the distinction between "availability source" and "booking link sent to leads".

## Inputs
- Phase 58a: Schema updated with `publicUrl` field
- Phase 58b: `getBookingLink()` updated to use `publicUrl` with fallback
- Existing Calendar Link UI components (need to locate)

## Work

### Step 1: Locate Calendar Link UI Components

Search for:
- Calendar link settings forms
- CalendarLink CRUD actions in `actions/`
- Settings components that manage calendar links

Likely locations:
- `components/dashboard/settings/calendar-*`
- `actions/calendar-link-actions.ts` (or similar)
- `app/(dashboard)/settings/*` pages

### Step 2: Update Server Actions

Add `publicUrl` to any server actions that create/update CalendarLinks:

```typescript
// In actions/calendar-link-actions.ts (or equivalent)
export async function updateCalendarLink(data: {
  id: string;
  name?: string;
  url?: string;
  publicUrl?: string | null;  // Add this field
  isDefault?: boolean;
}) {
  // ... existing validation ...
  await prisma.calendarLink.update({
    where: { id: data.id },
    data: {
      name: data.name,
      url: data.url,
      publicUrl: data.publicUrl,  // Add this
      isDefault: data.isDefault,
    },
  });
}
```

### Step 3: Update Settings Form UI

Add a new optional field for "Public Booking Link":

**UI Copy/Labels:**
- **Availability URL** (existing `url` field): "Calendar URL used to fetch availability slots"
  - Helper text: "This URL is used internally to check your calendar availability. Enter the full URL from your calendar provider."
- **Public Booking Link** (new `publicUrl` field): "Booking link sent to leads (optional)"
  - Helper text: "If different from above, enter the link you want leads to see in messages. Leave empty to use the availability URL."
  - Placeholder: "Leave empty to use availability URL"

**Field Ordering:**
1. Name
2. Availability URL (required)
3. Public Booking Link (optional)
4. Calendar Type (auto-detected)
5. Default toggle

### Step 4: Handle Empty vs Null

In the UI:
- Empty string → save as `null` (use fallback behavior)
- Non-empty string → save as-is

### Step 5: Validation

- Validate `publicUrl` is a valid URL format if provided
- Allow clearing (setting to null/empty) at any time

## Output
- Updated CalendarLink settings form with `publicUrl` field
- Updated server actions to persist `publicUrl`
- Clear UX copy explaining the distinction between availability URL and public booking link

## Handoff
Phase 58d will verify all integration points and add documentation for the feature.
