# Phase 80f — UI: Schedule Mode Settings

## Focus

Add user interface controls for configuring auto-send schedule mode at workspace and campaign levels.

## Inputs

- Phase 80e complete (backend fully implemented)
- Current settings UI: `components/dashboard/settings-view.tsx`
- Current campaign UI: `components/dashboard/settings/ai-campaign-assignment.tsx`
- Server actions: `actions/settings-actions.ts`, `actions/email-campaign-actions.ts`

## Work

### 1. Workspace Settings UI

**File:** `components/dashboard/settings-view.tsx`

Add schedule mode selector in the AI/Automation section:

```tsx
{/* Auto-Send Schedule */}
<div className="space-y-2">
  <Label>AI Auto-Send Schedule</Label>
  <Select
    value={settings.autoSendScheduleMode || "ALWAYS"}
    onValueChange={(v) => handleChange("autoSendScheduleMode", v)}
  >
    <SelectTrigger>
      <SelectValue placeholder="Select schedule mode" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="ALWAYS">24/7 (always send)</SelectItem>
      <SelectItem value="BUSINESS_HOURS">Business hours only</SelectItem>
      <SelectItem value="CUSTOM">Custom schedule</SelectItem>
    </SelectContent>
  </Select>
  <p className="text-sm text-muted-foreground">
    When AI auto-send can fire. Business hours uses your workspace timezone and work hours.
  </p>
</div>

{/* Custom Schedule Editor (shown when CUSTOM selected) */}
{settings.autoSendScheduleMode === "CUSTOM" && (
  <CustomScheduleEditor
    value={settings.autoSendCustomSchedule}
    onChange={(v) => handleChange("autoSendCustomSchedule", v)}
    timezone={settings.timezone}
  />
)}
```

### 2. Campaign Assignment UI

**File:** `components/dashboard/settings/ai-campaign-assignment.tsx`

Add "Send Window" column to the campaign table:

```tsx
<TableHead>
  <div className="flex items-center gap-1.5">
    <Clock className="h-4 w-4" />
    <span>Send Window</span>
  </div>
</TableHead>

// In row:
<TableCell className="min-w-[180px]">
  <Select
    value={row.autoSendScheduleMode ?? "inherit"}
    onValueChange={(v) => updateCampaign(row.id, {
      autoSendScheduleMode: v === "inherit" ? null : v
    })}
    disabled={row.responseMode !== "AI_AUTO_SEND"}
  >
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="inherit">Inherit from workspace</SelectItem>
      <SelectItem value="ALWAYS">24/7</SelectItem>
      <SelectItem value="BUSINESS_HOURS">Business hours</SelectItem>
      <SelectItem value="CUSTOM">Custom...</SelectItem>
    </SelectContent>
  </Select>
</TableCell>
```

### 3. Server Actions

**File:** `actions/settings-actions.ts`

Add new fields to update handler:
```typescript
autoSendScheduleMode?: "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM";
autoSendCustomSchedule?: { days: number[]; startTime: string; endTime: string } | null;
```

**File:** `actions/email-campaign-actions.ts`

Extend `updateEmailCampaignConfig()`:
```typescript
autoSendScheduleMode?: "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM" | null;
autoSendCustomSchedule?: { days: number[]; startTime: string; endTime: string } | null;
```

### 4. Optional: Custom Schedule Editor Component

If time permits, create `components/dashboard/settings/custom-schedule-editor.tsx`:
- Day picker (checkboxes for Mon-Sun)
- Time range inputs (start/end)
- Preview of selected windows

### 5. Verify

- `npm run lint`
- `npm run build`
- Manual test: Change schedule mode in settings, verify persistence

## Output

- Workspace settings UI now includes auto-send schedule mode + custom day/time controls.
- Campaign assignment table includes per-campaign schedule overrides with custom day/time editor.
- Server actions updated to read/write `autoSendScheduleMode` + `autoSendCustomSchedule`.

## Handoff

Phase 80 complete. Final verification:
1. Run `npm run lint && npm run build`
2. Test "Meeting Booked" leads now get drafts
3. Test schedule mode changes persist and affect auto-send behavior
4. Test follow-up sequences complete on booking
