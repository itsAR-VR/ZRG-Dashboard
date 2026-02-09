# Phase 124 — Review (Auto Follow-Ups Toggle + SMS Follow-Up Reliability)

**Reviewed:** 2026-02-09  
**Scope:** Phase 124a–124d

## Summary
Phase 124 fixes two operationally critical problems:
- The **Auto Follow-ups (Positive Replies)** toggle failed to save for true super-admin sessions due to RBAC/capability gating mismatch.
- Follow-up sequences that include **SMS** could silently fail (missing phone / DND / config issues) and did not reliably preserve the “+2 minutes after setter reply” timing.

The result is that SMS follow-ups now either:
- **send**, or
- produce a **deterministic, visible, countable outcome** (blocked/skip with an audit task and UI surfacing).

## Key Changes

### 1) Auto Follow-ups Toggle RBAC + Settings Writes (Admin-Only)
- Treat true super-admin users as `OWNER` for capability checks so settings actions do not fail when the admin is not an explicit workspace member.
  - File: `lib/workspace-capabilities.ts`
- Tighten settings writes to admin-only by enforcing `capabilities.canEditSettings` in `requireSettingsWriteAccess()`.
  - File: `actions/settings-actions.ts`
- Allow reads of the toggle for any authenticated workspace user with access by using `requireClientAccess()` in `getAutoFollowUpsOnReply()`.
  - File: `actions/settings-actions.ts`

### 2) Follow-up Engine: SMS Reliability + Skip/Block With Audit
- SMS step now performs best-effort GHL hydration and if phone is still missing, **skips SMS and advances**, recording a `FollowUpTask` warning (no silent failures, no permanent stalls).
- DND failures now use bounded retry: `blocked_sms_dnd:attempt:N` with hourly reschedule up to 24 attempts; then skip-with-audit and advance.
- Missing GHL config and provider errors now pause with explicit reasons (`blocked_sms_config`, `blocked_sms_error`) and create/update a `FollowUpTask` for visibility.
- Sequences with `triggerOn="setter_reply"` bypass business-hours rescheduling for the **first step only** so “+2 minutes” stays “+2 minutes” (cron cadence permitting), while later steps still respect business hours.
  - File: `lib/followup-engine.ts`

### 3) Reactivation: Hydrate + Don’t Block on Missing Phone
- Reactivation attempts GHL hydration for SMS sequences and no longer blocks enrollment solely due to missing DB phone (missing GHL config remains a blocker).
  - File: `lib/reactivation-engine.ts`

### 4) UI: Surface SMS Non-Delivery Warnings
- Server Actions now attach `latestTask` (latest pending `FollowUpTask`) to each instance so the UI can show warnings for active instances.
  - File: `actions/followup-sequence-actions.ts`
- Follow-ups view and CRM drawer now surface `latestTask.suggestedMessage` warnings (e.g., “SMS skipped — missing phone”).
  - Files: `components/dashboard/follow-ups-view.tsx`, `components/dashboard/crm-drawer.tsx`

## Evidence (Quality Gates)
Commands executed on 2026-02-09:
- `npm test` — **pass** (261 tests)
- `npm run lint` — **pass** (warnings only)
- `npm run build` — **pass**

## Manual QA Checklist (Staging/Prod-Safe)
1. **Toggle save**
   - As workspace `ADMIN` or true super-admin: toggle **Auto Follow-ups (Positive Replies)** ON/OFF and refresh; confirm it persists.
   - As `SETTER` or `INBOX_MANAGER`: confirm the toggle is read-only / write fails.
2. **Setter reply +2m SMS**
   - Trigger a `triggerOn="setter_reply"` follow-up sequence (ZRG Workflow V1).
   - Confirm SMS sends ~2–3 minutes after the outbound setter email is sent (cron cadence), even outside business hours.
3. **Missing phone**
   - Use a lead missing `Lead.phone` and confirm:
     - System attempts hydration from GHL.
     - If still missing, SMS step is skipped and a warning is visible in CRM drawer and Follow-ups view.
4. **DND**
   - Simulate/ensure DND response and confirm:
     - Instance shows a DND blocked status (retrying).
     - System retries hourly (up to 24 attempts) and records tasks.
5. **Missing GHL config**
   - Remove/disable GHL config for a test workspace and confirm instance pauses with a clear “GHL not configured” message and audit task.

## Operational Notes (Where to Look When SMS Doesn’t Send)
- Instance-level status:
  - Check `FollowUpInstance.pausedReason` (blocked config/error/DND retry).
- Countable audit:
  - Check `FollowUpTask` rows for the instance (pending tasks should carry a `suggestedMessage`).
- UI surfacing:
  - CRM drawer + Follow-ups view show `latestTask.suggestedMessage` warning for active instances.

## Known Non-Blocking Warnings
- `npm run lint` reports existing warnings (no errors).
- Next build reports CSS optimization warnings unrelated to Phase 124 behavior.
