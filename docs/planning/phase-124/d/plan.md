# Phase 124d — Observability + UI Surfacing + End-to-End Verification

## Focus
Make SMS follow-up non-delivery visible and actionable (not silent), and verify the full flow end-to-end for both standard sequences and reactivation campaigns.

## Inputs
- Phase 124b outputs:
  - `FollowUpInstance.pausedReason` usage for blocked SMS cases
  - `FollowUpTask` creation for blocked SMS audit/counting
  - DND retry state encoded in `pausedReason` (e.g., `"blocked_sms_dnd:attempt:3"`)
- Phase 124c outputs:
  - Reactivation prereq hydration + needs_review reasons
- UI:
  - `components/dashboard/crm-drawer.tsx` — follow-up instances rendering
  - `components/dashboard/follow-ups-view.tsx` — **`pausedReasonCopy` function (lines 313–345)** — primary paused-reason display logic (RED TEAM GAP-4)
  - Existing "Follow-ups blocked" and variable validation UI patterns
- Cron:
  - `app/api/cron/followups/route.ts` execution loop + logging

## Work
1. **UI surfacing — follow-ups-view.tsx** (RED TEAM GAP-4)
   - Extend the `pausedReasonCopy` function in `components/dashboard/follow-ups-view.tsx` to handle new paused reasons:
     - `awaiting_enrichment` → already mapped ("Awaiting enrichment")
     - `blocked_sms_dnd` (including `blocked_sms_dnd:attempt:N`) → "SMS blocked — DND active (retry N/24)" or "SMS blocked — DND active, retrying hourly"
     - `blocked_sms_config` → "SMS blocked — GoHighLevel not configured"
     - `blocked_sms_error` → "SMS failed — retry or check GoHighLevel"
2. **UI surfacing — crm-drawer.tsx**
   - Extend CRM drawer follow-up instance display to show the same clear status text as above.
   - Ensure operators can understand the next action (add phone, fix GHL config, remove DND, etc.).
3. **UI surfacing — skipped SMS (missing phone)**
   - Because missing-phone SMS steps are **skipped and the instance advances** (not paused), pausedReason mappings alone are insufficient.
   - Add UI support to surface the latest relevant `FollowUpTask` for an instance/lead (e.g., `SMS skipped — missing phone`) as a warning banner on the sequence card in:
     - `components/dashboard/crm-drawer.tsx`
     - `components/dashboard/follow-ups-view.tsx`
4. **Audit trail consistency**
   - Ensure FollowUpTask records created for blocked/skipped SMS are human-readable and consistent across follow-up engine + reactivation.
   - Verify DND exhaustion (24 attempts) creates a clear terminal FollowUpTask.
5. **Verification checklist**
   - Local quality gates:
     - `npm run lint`
     - `npm test`
     - `npm run build`
   - Manual QA (staging/prod-safe):
     - ZRG Workflow V1: send a setter email reply; confirm SMS sends ~2 minutes later **even outside business hours** (or blocks with reason).
     - Reactivation: run a campaign with SMS in follow-up sequence; confirm hydration allows sequence start and SMS send.
     - Negative cases: DND (verify retry behavior), missing GHL API key, missing phone.
     - Verify follow-ups view shows correct paused reason copy for each blocked state.
     - Missing phone: verify SMS is skipped (instance advances) and a warning is visible via FollowUpTask.
5. **Operational guidance**
   - Document a short runbook entry (where to look when SMS doesn't send):
     - check FollowUpInstance status/pausedReason in CRM drawer
     - check FollowUpTask "blocked SMS" records
     - confirm GHL config + contact phone
     - DND: system retries hourly for 24 attempts, then skips

## Files Modified
- `components/dashboard/follow-ups-view.tsx` — `pausedReasonCopy` mappings
- `components/dashboard/crm-drawer.tsx` — blocked SMS status display

## Output
- UI shows blocked/pause reasons for SMS follow-up non-delivery in **both** follow-ups view and CRM drawer.
- DND retry state is visible (e.g., "retry 3/24").
- FollowUpTask audit trail exists for blocked SMS cases.
- Verified via lint/test/build (manual QA pending).

## Handoff
Write `docs/planning/phase-124/review.md` after implementation with:
- commands run + results,
- screenshots/log evidence (redacted),
- any follow-up issues discovered,
- delete `_conflicts/` directory.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `latestTask` wiring so the UI can surface non-delivery warnings even when instances remain active (e.g., missing-phone SMS skipped). (file: `actions/followup-sequence-actions.ts`)
  - Updated Follow-ups view to show SMS warning banners for active instances using the latest pending `FollowUpTask`. (file: `components/dashboard/follow-ups-view.tsx`)
  - Updated CRM drawer to show the same warning for active follow-up instances. (file: `components/dashboard/crm-drawer.tsx`)
- Commands run:
  - `npm test` — pass (261 tests)
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - Manual QA still needed (staging/prod) to confirm the warning is shown for real instances and to validate end-to-end SMS sends.
- Next concrete steps:
  - Write `docs/planning/phase-124/review.md` with evidence and manual QA checklist.
  - Remove `docs/planning/phase-124/_conflicts/` after review is written.
