# Phase 124 — RED TEAM Findings

**Reviewed:** 2026-02-09
**Scope:** Root plan + subphases 124a–124d
**Verdict:** Plan is well-structured and mostly repo-accurate. **6 actionable gaps** (2 high, 3 medium, 1 low) + 1 cleared. Refinements needed before execution.

## Update (Post Q&A)
After operator decisions on 2026-02-09, Phase 124 policy changed:
- Missing phone on SMS step: **skip + advance**, but record a durable artifact and surface a UI warning (no silent skips).
- Business hours: for `FollowUpSequence.triggerOn="setter_reply"`, **bypass business-hours rescheduling for the first step only** so "+2 minutes" stays "+2 minutes" (cron cadence permitting), while later steps still respect business hours.

Plans in `docs/planning/phase-124/plan.md`, `docs/planning/phase-124/b/plan.md`, `docs/planning/phase-124/c/plan.md`, and `docs/planning/phase-124/d/plan.md` were updated accordingly. Some findings below referencing `blocked_missing_phone` as a pause state are now obsolete.

---

## Repo Reality Check

| Claim in Plan | Verified? | Finding |
|---|---|---|
| `requireWorkspaceCapabilities()` in `lib/workspace-capabilities.ts` | **Already fixed** | The working tree already contains the super-admin → OWNER mapping (lines 41–50). Phase 124a describes implementing this, but it's already done. |
| `setAutoFollowUpsOnReply()` in `actions/settings-actions.ts` | **Correct** | Function at line 712. Calls `requireSettingsWriteAccess()` which checks `capabilities.isClientPortalUser` (not `canEditSettings`). |
| `resolveGhlContactIdForLead()` in `lib/ghl-contacts.ts` | **Correct** | Defined at line 40. Search-only, no implicit creation. Used in 2 files (message-actions, conversation-sync). |
| `sendSmsSystem()` in `lib/system-sender.ts` | **Correct** | Core SMS sender wrapping GHL API. |
| `FollowUpInstance.pausedReason` is `String?` | **Correct** | Prisma schema confirms nullable string, no enum constraint. |
| `FollowUpTask` model exists and has `instanceId` field | **Correct** | Schema lines 1089–1112. Has `instanceId`, `stepOrder`, `status`, `type`. |
| Plan says "no Prisma schema changes needed" | **Correct** | `pausedReason` is a free-form string; `FollowUpTask` already has the needed fields. |
| Follow-ups cron runs every minute | **Plausible** | Plan says "every minute"; CLAUDE.md says "every 10 min". Verify `vercel.json` cron schedule. |
| `lib/followup-automation.ts` exists | **Needs verification** | Referenced in 124b but not confirmed by search. Verify this file exists and contains `autoStartMeetingRequestedSequenceOnSetterEmailReply()`. |
| `lib/reactivation-sequence-prereqs.ts` exists | **Referenced** | Mentioned in 124b and 124c; tests exist (`reactivation-sequence-prereqs.test.ts`). |
| Existing `pausedReason` values include `blocked_missing_phone`, `blocked_sms_dnd`, etc. | **Not yet** | These are **new** values the plan proposes. Currently only `awaiting_enrichment`, `lead_replied`, `linkedin_unreachable`, `unipile_disconnected`, `awaiting_approval`, `email_send_uncertain`, `lead_snoozed`, `meeting_booked`, and dynamic `missing_*:...` prefixes exist. |

---

## RED TEAM Findings

### GAP-1: Phase 124a fix is already implemented in working tree [HIGH]

**Problem:** `lib/workspace-capabilities.ts` already contains the super-admin → OWNER capability mapping (lines 41–50 of the dirty working tree). Phase 124a describes "Implement capability mapping" as if it's new work, but it's done.

**Risk:** An executor might re-implement it (causing merge conflicts), or skip it (missing test coverage).

**Fix:** Rewrite 124a to:
1. **Validate** the existing uncommitted fix (review diff, confirm correctness).
2. **Write tests** for the fix (super-admin → `canEditSettings=true`, CLIENT_PORTAL → `canEditSettings=false`).
3. **Commit** the validated fix with test coverage.

---

### GAP-2: `requireSettingsWriteAccess()` checks `isClientPortalUser`, not `canEditSettings` [HIGH]

**Problem:** `actions/settings-actions.ts:118-122` shows:
```typescript
async function requireSettingsWriteAccess(clientId: string): Promise<void> {
  const { capabilities } = await requireWorkspaceCapabilities(clientId);
  if (capabilities.isClientPortalUser) {
    throw new Error("Unauthorized");
  }
}
```

This only blocks `CLIENT_PORTAL` users. It does **not** check `capabilities.canEditSettings`. Any non-CLIENT_PORTAL role (SETTER, INBOX_MANAGER) can currently write settings.

**Risk:** The plan focuses on the super-admin RBAC path but doesn't address whether SETTER/INBOX_MANAGER roles should be able to modify the Auto Follow-ups toggle. If the intent is that only admins can edit settings, `requireSettingsWriteAccess` should check `canEditSettings` instead of just `isClientPortalUser`.

**Decision: Admins only.** Change `requireSettingsWriteAccess` to check `!capabilities.canEditSettings` instead of `capabilities.isClientPortalUser`. This restricts settings writes to OWNER + ADMIN roles. Add to 124a scope.

---

### GAP-3: Behavioral inversion — plan says "pause on DND" but current code says "skip and advance" [MEDIUM] — DECIDED

**Problem:** Phase 124b proposes: "DND: pause as `blocked_sms_dnd` (do not advance)."

Current behavior in `lib/followup-engine.ts:1639-1731`:
```typescript
// DND - Non-retriable
if (sendResult.errorCode === "sms_dnd" || ...) {
  // Create skipped FollowUpTask
  // Advance sequence (do NOT pause)
  return { success: true, action: "skipped", advance: true }
}
```

**Decision: Bounded hourly retry for 24 business hours, excluding weekends.**

Instead of pausing permanently or skipping immediately, the SMS step should:
1. Set `pausedReason: "blocked_sms_dnd"` and reschedule `nextStepDue` to +1 hour.
2. On each cron tick, if `pausedReason === "blocked_sms_dnd"`, re-attempt the SMS send.
3. Track retry count (use existing `FollowUpTask` or a metadata field). After **24 hourly attempts** (business hours only, skip Saturday/Sunday), give up and **skip the SMS step + advance** with a FollowUpTask recording the terminal DND skip.
4. Weekend logic: If `nextStepDue` would land on Saturday/Sunday, roll forward to Monday 9 AM (or workspace business-hours start).

**Implementation implications:**
- Need a retry counter for DND attempts — can use a `FollowUpTask` with `status: "pending"` and an incrementing note, or a new field on `FollowUpInstance` (but plan prefers no schema changes).
- Alternative: encode retry state in `pausedReason` itself, e.g., `"blocked_sms_dnd:attempt:3"` — parseable, no schema change needed.
- Business-hours awareness already exists in the follow-up engine (scheduling logic); reuse it for weekend exclusion.
- This adds ~24 cron executions per DND lead per sequence, which is manageable given the 1-minute cron interval.

**Update 124b plan** to replace "DND: pause as `blocked_sms_dnd`" with this bounded retry strategy.

---

### GAP-4: No UI mapping for new `pausedReason` values in `follow-ups-view.tsx` [MEDIUM]

**Problem:** Phase 124d says to "extend CRM drawer" (`crm-drawer.tsx`) for the new blocked reasons. But the **primary** `pausedReason` display logic lives in `components/dashboard/follow-ups-view.tsx:313-345`, not just in the CRM drawer.

Current `follow-ups-view.tsx` has a `pausedReasonCopy` function that maps known reasons to user-facing text. The new values (`blocked_missing_phone`, `blocked_sms_dnd`, `blocked_sms_config`, `blocked_sms_error`) have no mapping there yet.

**Risk:** New paused reasons will display as raw strings ("Paused — blocked_sms_dnd") in the follow-ups view if `follow-ups-view.tsx` isn't updated alongside the CRM drawer.

**Fix:** Add `components/dashboard/follow-ups-view.tsx` to 124d's file list and specify the `pausedReasonCopy` mappings for all new reason strings:
- `blocked_missing_phone` → "Missing phone number — enrich or add manually"
- `blocked_sms_dnd` → "SMS blocked — DND active on this contact"
- `blocked_sms_config` → "SMS blocked — GoHighLevel not configured"
- `blocked_sms_error` → "SMS failed — retry or check GoHighLevel"

---

### GAP-5: `_conflicts/` directory suggests duplicate planning [MEDIUM]

**Problem:** `docs/planning/phase-124/_conflicts/other-agent-2026-02-09/` contains a full duplicate set of subphase plans (a/b/c/d). These appear to be from another agent that planned the same scope under a different numbering. The plans in the conflicts directory reference "Phase 123" numbering internally.

**Risk:**
- Confusion about which plans are canonical.
- An executor might read the wrong plans.
- Stale conflict artifacts in the repo after implementation.

**Decision: Delete after completion.** Keep for reference during implementation; clean up `_conflicts/` when writing `review.md`. Add a note to root plan marking root-level a/b/c/d as canonical.

---

### GAP-6: `lib/followup-automation.ts` reference — CLEARED

**Verified:** `lib/followup-automation.ts` exists and contains `autoStartMeetingRequestedSequenceOnSetterEmailReply()`. No action needed.

---

### GAP-7: Phase 124b resume logic change could break existing `awaiting_enrichment` flows [LOW]

**Problem:** Phase 124b says: "Update `resumeAwaitingEnrichmentFollowUps*()` so terminal enrichment does not auto-advance past SMS steps; instead convert to `blocked_missing_phone`."

Currently, `resumeAwaitingEnrichmentFollowUps()` (lines 2348–2540 of followup-engine.ts) advances past blocked steps when enrichment is terminal. This is a deliberate escape hatch to prevent sequences from being permanently stuck.

**Risk:** Changing this to `blocked_missing_phone` (permanent pause) means sequences with missing phones will never complete without manual intervention. If the lead later gets a phone added (e.g., from a form fill), there's no automatic resume trigger for `blocked_missing_phone`.

**Decision: Auto-resume on phone add.** Add a hook in lead update actions (where phone is set/updated) that queries for `FollowUpInstance` records with `pausedReason: "blocked_missing_phone"` for that lead and resumes them. This mirrors the existing `resumeAwaitingEnrichmentFollowUps()` pattern. Add to 124b scope.

---

## Open Questions — All Resolved

1. **Cron frequency — RESOLVED:** `vercel.json` confirms `"schedule": "* * * * *"` (every minute). CLAUDE.md is outdated. Consider updating.

2. **DND behavior — RESOLVED:** Bounded hourly retry for 24 business hours (excluding weekends). After exhaustion, skip + advance with audit artifact. See GAP-3.

3. **Settings permission scope — RESOLVED:** Admins only (`canEditSettings` check). See GAP-2.

4. **`blocked_missing_phone` resume — RESOLVED:** Auto-resume hook in lead update actions when phone is added. See GAP-7.

5. **Conflict directory — RESOLVED:** Delete after completion, keep for reference during implementation. See GAP-5.

---

## Assumptions

1. The uncommitted fix in `lib/workspace-capabilities.ts` is correct and should be committed as-is (after test validation).
2. `FollowUpInstance.pausedReason` being a free-form string (not an enum) is intentional and will remain so.
3. `resolveGhlContactIdForLead()` is safe to call during cron execution (no rate-limit concerns for the GHL search endpoint in this context).
4. The follow-ups cron has sufficient execution time budget to handle the additional GHL API call for phone hydration per SMS step.

---

## Validation Steps

After refinements:
- [x] ~~Confirm `lib/followup-automation.ts` exists and contains referenced functions (GAP-6)~~ — Verified
- [x] ~~Confirm followups cron frequency in `vercel.json` (Open Question 1)~~ — Every minute (`* * * * *`)
- [x] ~~Decision recorded for DND behavior (GAP-3)~~ — Bounded hourly retry, 24 business hours, skip on exhaustion
- [x] ~~Decision recorded for settings permission scope (GAP-2)~~ — Admins only via `canEditSettings`
- [ ] All new `pausedReason` values have mappings in both `crm-drawer.tsx` AND `follow-ups-view.tsx` (GAP-4) — during implementation
- [x] ~~Resume mechanism defined for `blocked_missing_phone` (GAP-7)~~ — Auto-resume hook on lead phone update
- [x] ~~`_conflicts/` directory cleanup plan noted (GAP-5)~~ — Delete after completion

---

## Multi-Agent Coordination Check

| Check | Status | Detail |
|---|---|---|
| Phase 123 overlap | **Clear** | Phase 123 scope (draft pipeline memory + overseer loop) does not touch follow-up engine, RBAC, or SMS paths. No file conflicts expected. |
| Phase 122/121 overlap | **Managed** | Both complete and committed. Phase 124 builds on their work in `lib/followup-engine.ts` without reverting any changes. |
| Working tree dirty file | **Accounted** | `lib/workspace-capabilities.ts` is the Phase 124a fix. Plan should land it with test coverage. |
| Phase 125 | **Unknown** | `docs/planning/phase-125/` exists (untracked). Scope unknown — verify it doesn't touch follow-up engine or RBAC. |
