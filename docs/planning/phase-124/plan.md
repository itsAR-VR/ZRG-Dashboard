# Phase 124 — Fix Auto Follow-Ups Toggle + SMS Follow-Up Reliability (Reactivation + ZRG Workflow)

## Purpose
Make follow-up automation reliable by ensuring:
1. The **Auto Follow-ups (Positive Replies)** workspace toggle updates successfully and persists.
2. Follow-up sequences that include **SMS steps actually send**, especially:
   - **ZRG Workflow V1**: SMS should send **2 minutes after** the setter's first outbound email reply.
   - **Reactivation**: follow-up sequences must not silently "email-only" when SMS is required.

## Context
- Jam (2026-02-09) shows enabling Auto Follow-ups fails with `Failed to update auto follow up setting`. Network trace shows the Server Action responded `{ success: false, error: "Failed to update auto follow-up setting" }`, consistent with RBAC/capability gating incorrectly rejecting true super-admin sessions that are not explicit members/owners.
- Operators report that follow-up sequences are active but **SMS is not being sent**, and this breaks workflows (especially reactivation).
- Repo reality (verified):
  - Follow-ups cron: `GET /api/cron/followups` runs every minute (`vercel.json`: `"* * * * *"`) and calls `processFollowUpsDue()` in `lib/followup-engine.ts`.
  - ZRG Workflow V1 / Meeting Requested default sequence defines Day 1 SMS with `minuteOffset: 2` after setter reply (Phase 66).
  - SMS sends via GoHighLevel in `lib/system-sender.ts:sendSmsSystem()`.
  - Reactivation can start a follow-up sequence after sending a bump email (`lib/reactivation-engine.ts`), but prereq logic currently blocks when `Lead.phone` is missing even if the phone exists in GHL.
- **Working tree note:** `lib/workspace-capabilities.ts` already contains the super-admin → OWNER capability fix (uncommitted). Phase 124a validates and lands this.

## Concurrent Phases
Overlaps detected by scanning recent phases and current repo state (`git status --porcelain`).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 123 | Active (just created) | Unrelated domain (draft pipeline memory + overseer loop) | Keep Phase 124 changes focused on follow-ups/SMS/RBAC; do not touch Phase 123 scope. |
| Phase 122 | Complete | `lib/followup-engine.ts` | Preserve booking/overseer hardening; keep changes localized to follow-up execution paths. |
| Phase 121 | Complete | `lib/followup-engine.ts` | Preserve follow-up safety semantics while hardening SMS. |
| Working tree | Dirty | `lib/workspace-capabilities.ts` modified | Validate and land the existing fix as part of Phase 124a; avoid bundling unrelated edits. |

**Canonical plans:** Root-level `a/`, `b/`, `c/`, `d/` subphase directories. (Duplicate `_conflicts/` artifacts removed.)

## Objectives
* [x] Fix Auto Follow-ups toggle failures (capabilities/RBAC) and tighten settings permissions to admin-only.
* [x] Ensure SMS follow-up steps either send **or** produce an explicit, countable outcome. Policy:
  - missing phone → skip SMS and advance (but record + surface in UI)
  - missing GHL config / provider errors → block with visible reason + audit artifact
  - DND → bounded retry then skip with audit artifact
* [x] Ensure the "Day 1 SMS (+2 min after setter reply)" schedule is honored (anchored to the email's `sentAt`) **even outside business hours** for `triggerOn="setter_reply"` sequences.
* [x] Ensure reactivation campaigns start follow-up sequences reliably by hydrating from GHL before we decide an SMS step can't send.
* [x] Make SMS non-delivery **countable and visible** (blocked reasons in UI + durable artifacts in DB).
* [x] DND SMS: bounded hourly retry (attempt counter), then skip + audit.
* [x] Validate with `npm run lint`, `npm test`, `npm run build`.
* [ ] Manual QA (staging/prod-safe): verify toggle + setter-reply SMS + reactivation + missing-phone warnings.

## Constraints
- Never commit secrets/tokens/PII.
- Prefer **no Prisma schema changes**; use existing tables/fields for observability:
  - `FollowUpInstance.pausedReason` (free-form string — encode retry state here, e.g., `"blocked_sms_dnd:attempt:3"`)
  - `FollowUpTask` rows for "blocked SMS" artifacts
- Preserve existing automation safety semantics:
  - workspace follow-up pause (`WorkspaceSettings.followUpsPausedUntil`)
  - business-hours scheduling/rescheduling (except where explicitly bypassed below)
  - pause-on-lead-reply behavior
- Business hours bypass:
  - For sequences with `FollowUpSequence.triggerOn="setter_reply"`, bypass business-hours rescheduling for the **first step only** (stepOrder=1) so "+2 minutes" stays "+2 minutes" (cron cadence permitting). Later steps follow business hours.
- Keep changes surgical: follow-ups/SMS paths + RBAC only.

## Success Criteria
1. Auto Follow-ups toggle updates without error and persists on refresh for true super-admin sessions across any workspace.
2. Settings writes restricted to OWNER + ADMIN roles (SETTER/INBOX_MANAGER/CLIENT_PORTAL are read-only).
3. ZRG Workflow V1 Day 1 SMS sends within ~2–3 minutes after the setter's first outbound email reply (cron cadence) when prerequisites are satisfied, **even outside business hours**.
4. Reactivation workflows hydrate before deciding SMS can't send (avoid false negatives when phone exists in GHL but is missing in DB).
5. When an SMS step can't send, the system is explicit and countable:
   - Missing phone: **skip SMS and advance**, and record a durable artifact (FollowUpTask) that is visible in UI.
   - Missing GHL config / provider errors: **block** with a visible reason and a durable artifact (FollowUpTask).
   - DND: retry on a bounded schedule; after exhaustion, **skip and advance** with a durable artifact (FollowUpTask).
6. Quality gates pass: `npm run lint`, `npm test`, `npm run build`.

## Subphase Index
* a — Auto Follow-ups toggle reliability (validate existing fix + tighten permissions + tests)
* b — Follow-up engine SMS hardening (hydration + blocking + DND retry + auto-resume hook + scheduling)
* c — Reactivation workflow: start sequences reliably for SMS (hydrate before prereq blocking)
* d — Observability + UI surfacing (CRM drawer + follow-ups view) + end-to-end verification

## Success Criteria Status (Running)
- [x] (1) Auto Follow-ups toggle RBAC fixed for true super-admin sessions (code complete; manual QA pending).
- [x] (2) Settings writes restricted to OWNER + ADMIN via `capabilities.canEditSettings`.
- [x] (3) Setter-reply sequences bypass business-hours rescheduling for the **first step only**, preserving "+2 minutes" timing (cron cadence permitting).
- [x] (4) Reactivation hydrates via GHL and no longer blocks solely on missing DB phone.
- [x] (5) SMS non-delivery is explicit and countable via `FollowUpTask` + UI warnings (no silent email-only).
- [x] (6) Quality gates passed (2026-02-09): `npm test`, `npm run lint` (warnings only), `npm run build`.
- [ ] Manual QA: verify real-world GHL sends + UI warnings in staging/prod.

## Phase Summary (running)
- 2026-02-09 — Fixed Auto Follow-ups toggle RBAC + tightened settings write permissions. (files: `lib/workspace-capabilities.ts`, `actions/settings-actions.ts`)
- 2026-02-09 — Hardened SMS follow-ups (GHL hydration, skip-with-audit on missing phone, bounded DND retry, explicit blocked reasons). (files: `lib/followup-engine.ts`)
- 2026-02-09 — Reactivation now hydrates and starts follow-ups even when DB phone is missing (SMS will skip-with-audit if still missing). (files: `lib/reactivation-engine.ts`)
- 2026-02-09 — Surfaced SMS non-delivery warnings in Follow-ups view + CRM drawer using latest pending `FollowUpTask`. (files: `actions/followup-sequence-actions.ts`, `components/dashboard/follow-ups-view.tsx`, `components/dashboard/crm-drawer.tsx`)
- 2026-02-09 — Verified quality gates: `npm test`, `npm run lint`, `npm run build`. (files: `scripts/test-orchestrator.ts`)
- 2026-02-09 — Wrote review + removed `_conflicts` planning artifacts to avoid confusion. (files: `docs/planning/phase-124/review.md`, `docs/planning/phase-124/plan.md`)
- 2026-02-09 — Refined business-hours bypass to apply to setter-reply sequences’ first step only (per operator decision). (files: `lib/followup-engine.ts`, `docs/planning/phase-124/*`)

## Decisions (Resolved)
- [x] SMS non-delivery “counted for”: **Audit only** (FollowUpTask + UI warning), no KPI/reporting work in Phase 124.
- [x] Missing-phone SMS task status: keep `FollowUpTask.status="pending"` so it remains visible/actionable in current UI.
- [x] Setter-reply business-hours: **bypass first step only** (preserve “+2 minutes” semantics); later steps follow business hours.
