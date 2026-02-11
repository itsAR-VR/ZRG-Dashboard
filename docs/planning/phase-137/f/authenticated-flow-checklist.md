# Phase 137f — Authenticated Flow Verification Checklist

## Purpose
Collect final live evidence for the UX/performance hardening and polish changes in phase 137.

## Environment
- Use the same environment you intend to ship from (recommended: production-like/staging).
- Be logged in as a workspace admin user.
- Capture screenshots and notes for each scenario.

## Evidence Requirements
- For each scenario, provide:
  - `Result`: `PASS` / `FAIL`
  - `Notes`: what happened, including any mismatch from expected behavior
  - `Screenshots`: one or more image files

## Scenario A — Settings Deferred-Load Stability
### A1. General tab baseline
1. Open `Settings` on workspace A.
2. Verify the settings tab row is usable on your viewport (no clipped labels; horizontal scroll works on narrow width).
3. Confirm General tab loads without waiting for Integrations/Booking-heavy data.

Expected:
- General content is immediately usable.
- Tabs remain readable and selectable.

Suggested screenshots:
- `137f-A1-settings-general-initial.png`
- `137f-A1-settings-tabs-mobile-or-narrow.png`

### A2. Workspace + tab churn
1. Switch between workspaces A and B.
2. On each workspace, switch `General -> Integrations -> Booking -> General` quickly.
3. Verify Integration/Booking data shown belongs to the currently selected workspace.

Expected:
- No stale workspace data leakage.
- Integrations and Booking panels load correctly after tab/workspace switches.

Suggested screenshots:
- `137f-A2-workspaceA-integrations.png`
- `137f-A2-workspaceB-integrations.png`
- `137f-A2-workspaceB-booking.png`

### A3. Booking provider switch
1. In Settings Booking, switch provider between GHL and Calendly (if available).
2. Confirm mismatch/status blocks and calendars/users reflect the active provider.

Expected:
- Provider-specific UI/state updates correctly.
- No mixed GHL/Calendly stale state.

Suggested screenshots:
- `137f-A3-provider-ghl.png`
- `137f-A3-provider-calendly.png`

## Scenario B — Action Station LinkedIn Recovery UX
### B1. LinkedIn status loading/copy
1. Open a lead with LinkedIn channel.
2. Observe status row while status is loading, then loaded.

Expected:
- Loading copy reads “Checking LinkedIn status...”.
- Success hint and badge hierarchy are readable.

Suggested screenshots:
- `137f-B1-linkedin-loading.png`
- `137f-B1-linkedin-loaded.png`

### B2. LinkedIn status failure retry
1. Reproduce a LinkedIn status error state (if available).
2. Click `Retry` in the status row.

Expected:
- Error row includes clear context and retry control.
- Retry attempts a fresh status fetch.

Suggested screenshots:
- `137f-B2-linkedin-error-before-retry.png`
- `137f-B2-linkedin-after-retry.png`

### B3. Send failure fallback copy
1. Trigger one send failure on each available channel (SMS/Email/LinkedIn), if safely possible.
2. Confirm fallback error copy is channel-specific.

Expected:
- SMS: “SMS send failed...”
- Email: “Email send failed...”
- LinkedIn: “LinkedIn send failed...”

Suggested screenshots:
- `137f-B3-sms-send-failure.png`
- `137f-B3-email-send-failure.png`
- `137f-B3-linkedin-send-failure.png`

## Scenario C — CRM Drawer Accessibility + State Integrity
### C1. Status/Sentiment control labeling
1. Open a lead in CRM drawer.
2. Verify visible labels for Status and Sentiment.
3. Change each control once.

Expected:
- Status/Sentiment controls are clearly labeled and usable.
- Updates apply without UI breakage.

Suggested screenshots:
- `137f-C1-crm-status-control.png`
- `137f-C1-crm-sentiment-control.png`

### C2. Follow-up + booking loading/progress
1. Open follow-up sequence section and booking dialog.
2. Verify loading indicators and progress bar presentation remain coherent.

Expected:
- Loading states render cleanly.
- Follow-up progress bar remains visible and proportional.

Suggested screenshots:
- `137f-C2-followup-loading-or-active.png`
- `137f-C2-booking-loading-or-slots.png`

### C3. Lead switch reset safety
1. Open booking dialog on lead A and pick a slot.
2. Close/switch to lead B and reopen booking dialog.

Expected:
- Selected slot state does not leak from lead A to lead B.

Suggested screenshots:
- `137f-C3-leadA-slot-selected.png`
- `137f-C3-leadB-slot-reset.png`

## Results Table (Fill In)
| Scenario | Result | Notes | Screenshot Files |
|---|---|---|---|
| A1 |  |  |  |
| A2 |  |  |  |
| A3 |  |  |  |
| B1 |  |  |  |
| B2 |  |  |  |
| B3 |  |  |  |
| C1 |  |  |  |
| C2 |  |  |  |
| C3 |  |  |  |

