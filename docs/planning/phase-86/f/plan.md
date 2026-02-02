# Phase 86f — Settings UI + Tests + Verification Checklist

## Focus
Expose calendar health configuration in the dashboard (Booking settings) and add unit tests/verification steps for correctness and regressions.

## Inputs
- New `WorkspaceSettings` fields from Phase 86a: `calendarHealthEnabled`, `calendarHealthMinSlots`.
- Existing Settings UI: `components/dashboard/settings-view.tsx` (Booking tab).
- Existing settings persistence:
  - `actions/settings-actions.ts:16` — `UserSettingsData` interface
  - `actions/settings-actions.ts:115` — `getUserSettings()` function
  - `actions/settings-actions.ts:317` — `updateUserSettings()` function
- Counting utility: `countSlotsInWorkspaceWindow()` from Phase 86b.
- Test infrastructure: `lib/__tests__/*.test.ts` pattern, registered in `scripts/test-orchestrator.ts`.

## Work

### 1. Actions/types wiring
1. Update `UserSettingsData` interface in `actions/settings-actions.ts`:
   ```typescript
   // Calendar Health Check (Phase 86)
   calendarHealthEnabled: boolean;
   calendarHealthMinSlots: number;
   ```
2. Update `getUserSettings()` to select and return these fields from `WorkspaceSettings`.
3. Update `updateUserSettings()`:
   - Add admin gating for calendar health settings:
     ```typescript
     const wantsCalendarHealthUpdate =
       data.calendarHealthEnabled !== undefined ||
       data.calendarHealthMinSlots !== undefined;
     if (wantsCalendarHealthUpdate) {
       await requireClientAdminAccess(clientId);
     }
     ```
   - Validate `calendarHealthMinSlots`:
     ```typescript
     if (data.calendarHealthMinSlots !== undefined) {
       data.calendarHealthMinSlots = Math.max(0, Math.min(100, Math.round(data.calendarHealthMinSlots)));
     }
     ```
   - Add to upsert `update` and `create` blocks.

### 2. Settings UI
1. In `components/dashboard/settings-view.tsx`, locate the Booking tab section.
2. Add a "Calendar Health Check" subsection after existing availability settings:
   ```tsx
   {/* Calendar Health Check (Phase 86) */}
   <div className="space-y-4">
     <div className="flex items-center justify-between">
       <div>
         <Label>Weekly Calendar Health Check</Label>
         <p className="text-sm text-muted-foreground">
           Get Slack alerts when your calendar availability is low
         </p>
       </div>
       <Switch
         checked={settings.calendarHealthEnabled}
         onCheckedChange={(checked) => handleSettingChange("calendarHealthEnabled", checked)}
       />
     </div>
     {settings.calendarHealthEnabled && (
       <div className="space-y-2">
         <Label>Minimum slots required (next 7 weekdays)</Label>
         <Input
           type="number"
           min={0}
           max={100}
           value={settings.calendarHealthMinSlots}
           onChange={(e) => handleSettingChange("calendarHealthMinSlots", parseInt(e.target.value) || 0)}
         />
         <p className="text-sm text-muted-foreground">
           Alert when available slots fall below this threshold
         </p>
       </div>
     )}
   </div>
   ```
3. Add state for new fields with defaults:
   ```typescript
   calendarHealthEnabled: result.data.calendarHealthEnabled ?? true,
   calendarHealthMinSlots: result.data.calendarHealthMinSlots ?? 10,
   ```

### 3. Unit tests
1. Create `lib/__tests__/calendar-health.test.ts`:
   ```typescript
   import { describe, it } from "node:test";
   import assert from "node:assert";
   import { countSlotsInWorkspaceWindow, isValidTimezone } from "../calendar-health";

   describe("countSlotsInWorkspaceWindow", () => {
     it("counts slots within business hours on weekdays", () => { ... });
     it("excludes slots on weekends", () => { ... });
     it("excludes slots outside business hours", () => { ... });
     it("handles timezone conversion correctly", () => { ... });
     it("uses fallback timezone for invalid input", () => { ... });
     it("includes boundary times correctly (09:00 included, 17:00 excluded)", () => { ... });
     it("respects 7-day window", () => { ... });
     it("handles DST transition dates without throwing", () => { ... });
     it("dedupes slots by startTime", () => { ... });
   });

   describe("isValidTimezone", () => {
     it("returns true for valid IANA timezones", () => { ... });
     it("returns false for invalid timezone strings", () => { ... });
   });
   ```
2. Register test in `scripts/test-orchestrator.ts` if not auto-discovered.

### 4. Verification checklist (manual runbook)

```markdown
## Phase 86 Manual Verification Runbook

### Prerequisites
- [ ] Staging workspace with at least one CalendarLink configured
- [ ] Slack bot token and channel configured for workspace
- [ ] CRON_SECRET env var set

### Test Scenarios

#### A. Settings UI
1. [ ] Navigate to Settings > Booking tab
2. [ ] Verify "Weekly Calendar Health Check" toggle is visible and defaults to ON
3. [ ] Verify "Minimum slots required" input defaults to 10
4. [ ] Toggle OFF, save, refresh — verify OFF persists
5. [ ] Toggle ON, set threshold to 5, save — verify persists
6. [ ] Set threshold to 999 — verify clamped to 100

#### B. Cron Endpoint (Debug Mode)
1. [ ] Run: `curl -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/cron/calendar-health?clientId=xxx&force=true"`
2. [ ] Verify JSON response includes `workspacesChecked`, `calendarsBelowThreshold`
3. [ ] If calendars below threshold, verify Slack alert received (no link in message)

#### C. Dedupe
1. [ ] Run the same curl command twice
2. [ ] Verify second run shows `alertsSkipped` > 0
3. [ ] Verify no duplicate Slack messages

#### D. Auth
1. [ ] Run without auth header — verify 401 response
2. [ ] Run with wrong secret — verify 401 response

#### E. Time Window
1. [ ] Run without `force=true` on a non-Sunday or non-6pm ET time
2. [ ] Verify response: `skipped: true, reason: "outside_window"`
```

## Validation (RED TEAM)
- `npm run test` passes (including new calendar-health tests)
- `npm run lint` passes
- `npm run build` passes
- Settings UI renders correctly and persists changes

## Output
- Updated `actions/settings-actions.ts`:
  - Added `calendarHealthEnabled` + `calendarHealthMinSlots` to `UserSettingsData`
  - `getUserSettings()` now returns these fields (defaults: enabled=true, minSlots=10)
  - `updateUserSettings()` enforces workspace-admin gating for calendar health updates and clamps minSlots to `[0, 500]`
- Updated `components/dashboard/settings-view.tsx`:
  - Added a “Calendar Health Check” card in **Settings → General** (next to Calendar Links/Notifications)
  - Admin-only toggle + threshold input; persisted via `updateUserSettings`
- Added tests:
  - `lib/__tests__/calendar-health.test.ts` (weekdays + hour window + dedupe + invalid TZ fallback + DST smoke test)
- Verification commands run:
  - `npm test` ✅
  - `npm run lint` ✅ (warnings only)
  - `npm run build` ✅

### Phase 86 Manual Verification Runbook (Staging)
- Ensure workspace has:
  - At least 1 `CalendarLink` with a valid URL
  - Slack bot token configured
  - At least 1 Notification Center Slack channel configured
- In UI:
  - Settings → General → Calendar Health Check:
    - Toggle ON
    - Set threshold (e.g., 10)
    - Save Changes
- Trigger cron (authorized) outside the weekly window:
  - `curl -H "Authorization: Bearer $CRON_SECRET" "$NEXT_PUBLIC_APP_URL/api/cron/calendar-health?clientId=<CLIENT_ID>&force=1"`
- Confirm:
  - If below threshold: Slack alert posts (deduped on repeat runs)
  - If above threshold: no Slack message
  - Without auth: 401

## Handoff
- Phase 86 is implementation-complete; remaining work (optional) is product/ops tuning:
  - Confirm weekly timing expectation (Sun 6pm ET) in production
  - Decide whether to add a dashboard surfacing “last health check” + “current slot count” per workspace

## Assumptions / Open Questions (RED TEAM)
- **Assumption:** Settings changes take effect immediately on next cron run (~95% confidence)
  - Rationale: No caching of settings in cron route.
- **Assumption:** Test orchestrator auto-discovers `lib/__tests__/*.test.ts` files (~90% confidence)
  - Mitigation: Manually register if needed.
