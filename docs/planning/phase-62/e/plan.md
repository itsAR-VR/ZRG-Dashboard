# Phase 62e — Settings UI: Dual Booking Link Configuration

## Focus
Add UI fields to configure both booking links (with questions and without) for Calendly and GHL.

## Inputs
- Schema from 62a: New `WorkspaceSettings` fields
- Existing Settings UI in `components/dashboard/settings-view.tsx`
- Existing settings actions in `actions/settings-actions.ts`

## Work

### Update Settings UI
**File:** `components/dashboard/settings-view.tsx`

Add to the Booking Settings section:

**Calendly Section:**
```tsx
<div className="space-y-4">
  <h4 className="font-medium">Calendly Configuration</h4>

  {/* Existing field */}
  <div>
    <Label>Calendly Event Type (With Questions)</Label>
    <Input
      placeholder="https://calendly.com/yourname/founders-club"
      value={settings.calendlyEventTypeLink || ""}
      onChange={(e) => updateSettings({ calendlyEventTypeLink: e.target.value })}
    />
    <p className="text-xs text-muted-foreground mt-1">
      Use this for leads who have answered qualification questions
    </p>
  </div>

  {/* New field */}
  <div>
    <Label>Calendly Event Type (Direct Book - No Questions)</Label>
    <Input
      placeholder="https://calendly.com/yourname/intro-call"
      value={settings.calendlyDirectBookEventTypeLink || ""}
      onChange={(e) => updateSettings({ calendlyDirectBookEventTypeLink: e.target.value })}
    />
    <p className="text-xs text-muted-foreground mt-1">
      Use this for leads who haven't answered qualification questions.
      Falls back to the above link if not configured.
    </p>
  </div>
</div>
```

**GHL Section:**
```tsx
<div className="space-y-4">
  <h4 className="font-medium">GoHighLevel Configuration</h4>

  {/* Existing field */}
  <div>
    <Label>Default Calendar (With Questions)</Label>
    <Select
      value={settings.ghlDefaultCalendarId || ""}
      onValueChange={(v) => updateSettings({ ghlDefaultCalendarId: v })}
    >
      {/* calendar options */}
    </Select>
  </div>

  {/* New field */}
  <div>
    <Label>Direct Book Calendar (No Questions)</Label>
    <Select
      value={settings.ghlDirectBookCalendarId || ""}
      onValueChange={(v) => updateSettings({ ghlDirectBookCalendarId: v })}
    >
      <SelectItem value="">Same as default</SelectItem>
      {/* calendar options */}
    </Select>
    <p className="text-xs text-muted-foreground mt-1">
      Use this for direct booking leads who haven't answered qualification questions
    </p>
  </div>
</div>
```

### Update Settings Actions
**File:** `actions/settings-actions.ts`

Add new fields to `updateWorkspaceSettings()`:
```typescript
const allowedFields = [
  // ... existing fields ...
  "calendlyDirectBookEventTypeLink",
  "calendlyDirectBookEventTypeUri",
  "ghlDirectBookCalendarId",
];
```

### Add Calendly URI Resolution
When saving `calendlyDirectBookEventTypeLink`, resolve and store `calendlyDirectBookEventTypeUri` (same pattern as existing Calendly link):

```typescript
if (data.calendlyDirectBookEventTypeLink) {
  const resolved = await resolveCalendlyEventTypeUuidFromLink(data.calendlyDirectBookEventTypeLink);
  if (resolved?.uuid) {
    data.calendlyDirectBookEventTypeUri = toCalendlyEventTypeUri(resolved.uuid);
  }
}
```

### Validation
- [ ] Both Calendly links can be configured independently
- [ ] Both GHL calendars can be configured independently
- [ ] URI auto-resolution works for direct-book link
- [ ] Settings persist correctly
- [ ] `npm run lint` passes
- [ ] `npm run build` passes

## Output
- Updated Settings UI with dual booking link configuration
- Updated `actions/settings-actions.ts` to persist new fields

## Handoff
Settings UI is complete. Subphase 62f will wire the answer extraction into the inbound pipeline and perform end-to-end testing.
