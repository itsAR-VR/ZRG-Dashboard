# Phase 58b — Core Logic: Update `getBookingLink()` to Use `publicUrl` with Fallback

## Focus
Update the `getBookingLink()` function to prefer `publicUrl` when configured, falling back to `url` for backwards compatibility. This is the central integration point for all outbound booking link injection.

## Inputs
- Phase 58a: `CalendarLink.publicUrl` field added to schema
- `lib/meeting-booking-provider.ts`: Current `getBookingLink()` implementation (lines 36-57)
- Current consumers of `getBookingLink()`:
  - `lib/booking-process-instructions.ts` (line 188)
  - `lib/followup-engine.ts` (line 346)
  - Any other draft/template rendering code

## Work

### Step 1: Update `getBookingLink()` Function

Current implementation (GHL path):
```typescript
const calendarLink = await prisma.calendarLink.findFirst({
  where: {
    clientId,
    isDefault: true,
  },
  select: { url: true },
});
const url = (calendarLink?.url || "").trim();
return url || null;
```

Updated implementation:
```typescript
const calendarLink = await prisma.calendarLink.findFirst({
  where: {
    clientId,
    isDefault: true,
  },
  select: { url: true, publicUrl: true },
});

// Prefer publicUrl if set, otherwise fall back to url
const publicUrl = (calendarLink?.publicUrl || "").trim();
const url = (calendarLink?.url || "").trim();
return publicUrl || url || null;
```

### Step 2: Verify Calendly Path Consistency

The Calendly path uses `settings.calendlyEventTypeLink` directly. This is fine—it's a workspace-level setting, not a CalendarLink record. However, document that:
- Calendly uses `WorkspaceSettings.calendlyEventTypeLink` for outbound links
- GHL/HubSpot/unknown uses `CalendarLink.publicUrl || CalendarLink.url`

Consider: Should Calendly also support a separate "public link override"? For Phase 58, keep existing Calendly behavior unchanged. Add a note for potential future enhancement.

### Step 3: Audit All Consumers

Verify that all code paths using booking links flow through `getBookingLink()`:

1. **`lib/booking-process-instructions.ts:188`** — Booking process stage instructions
   - Uses `getBookingLink(clientId, workspaceSettings)` ✓

2. **`lib/followup-engine.ts:346`** — Follow-up sequence messages
   - Uses `getBookingLink(lead.clientId, settings)` ✓

3. **`lib/ai-drafts.ts`** — AI draft generation
   - Should flow through booking process instructions ✓

4. **Template variables** — `{calendarLink}` in follow-up templates
   - Resolved via `getBookingLink()` ✓

### Step 4: Add JSDoc Comments

Update function documentation to clarify the new behavior:

```typescript
/**
 * Get the booking link to send to leads in outbound messages.
 *
 * For Calendly workspaces: Returns settings.calendlyEventTypeLink
 * For GHL/other workspaces: Returns CalendarLink.publicUrl if set,
 *   otherwise falls back to CalendarLink.url
 *
 * Note: This returns the "frontend" link for leads, NOT the backend
 * URL used for fetching availability slots.
 */
```

## Output
- Updated `getBookingLink()` function with `publicUrl` support
- JSDoc documentation clarifying frontend vs backend URL semantics
- No breaking changes to existing integrations

## Handoff
Phase 58c will add UI support for editing `publicUrl` separately from `url` in the Calendar Link settings.
